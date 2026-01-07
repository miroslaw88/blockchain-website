// Video player functionality using MP4Box.js

import { getVideoPlayerModalTemplate } from '../templates';
import { fetchWithTimeout } from './utils';
import { Dashboard } from '../dashboard/index';

declare global {
    interface Window {
        MP4Box: any;
    }
}

/**
 * Show video player modal and play video using MP4Box
 */
export async function showVideoPlayerModal(merkleRoot: string, fileName: string, extraData?: string, chunkCount?: number): Promise<void> {
    // Remove any existing modal
    $('#videoPlayerModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getVideoPlayerModalTemplate(fileName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal
    const modalElement = document.getElementById('videoPlayerModal');
    if (!modalElement) {
        console.error('Failed to create video player modal');
        return;
    }
    
    const modal = new (window as any).bootstrap.Modal(modalElement);
    modal.show();
    
    // Get video element
    const videoElement = document.getElementById('videoPlayer') as HTMLVideoElement;
    const statusElement = document.getElementById('videoPlayerStatus');
    
    if (!videoElement) {
        console.error('Video element not found');
        return;
    }
    
    // Setup cleanup handler (modalElement is guaranteed to exist here)
    const cleanup = () => {
        if (videoElement.src && videoElement.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoElement.src);
        }
    };
    modalElement.addEventListener('hidden.bs.modal', cleanup, { once: true });
    
    try {
        // Parse MPEG-DASH manifest from extraData
        if (!extraData) {
            throw new Error('MPEG-DASH manifest not found in file metadata');
        }
        
        // Parse the MPD manifest XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(extraData, 'text/xml');
        
        // Extract video information from manifest
        const mpd = xmlDoc.querySelector('MPD');
        if (!mpd) {
            throw new Error('Invalid MPEG-DASH manifest');
        }
        
        // Get storage provider for downloading chunks
        const indexer = await Dashboard.waitForIndexer();
        const protocol = indexer.indexer_address.includes('localhost') || 
                        indexer.indexer_address.match(/^\d+\.\d+\.\d+\.\d+/) 
                        ? 'http' : 'https';
        const baseUrl = indexer.indexer_address.startsWith('http://') || indexer.indexer_address.startsWith('https://')
            ? indexer.indexer_address
            : `${protocol}://${indexer.indexer_address}`;
        
        // Query file info to get storage providers
        const downloadInfoUrl = `${baseUrl}/api/indexer/v1/files/query`;
        const walletAddress = sessionStorage.getItem('walletAddress') || '';
        
        const infoResponse = await fetchWithTimeout(downloadInfoUrl, 15000, {
            method: 'POST',
            body: JSON.stringify({
                merkle_root: merkleRoot,
                owner: walletAddress,
                requester: walletAddress
            })
        });
        
        if (!infoResponse.ok) {
            throw new Error(`Failed to query file info: ${infoResponse.status}`);
        }
        
        const downloadInfo = await infoResponse.json();
        const storageProviders = downloadInfo.storage_providers || [];
        
        if (storageProviders.length === 0) {
            throw new Error('No storage providers available for this file');
        }
        
        // Get encrypted_file_key from indexer response
        const fileData = downloadInfo.file || {};
        const encryptedFileKey = fileData.encrypted_file_key;
        if (!encryptedFileKey) {
            throw new Error('Encrypted file key not found in indexer response. File may not be properly encrypted.');
        }
        
        // Decrypt file's AES bundle with owner's private key
        const { decryptFileKeyWithECIES, decryptFile } = await import('../osd-blockchain-sdk');
        if (statusElement) {
            statusElement.innerHTML = '<span class="text-info">Decrypting file key...</span>';
        }
        
        const fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKey, walletAddress);
        
        const provider = storageProviders[0];
        const providerAddress = provider.provider_address;
        
        if (!providerAddress) {
            throw new Error('Storage provider address not found');
        }
        
        // Determine base URL for chunk downloads
        let chunkBaseUrl: string;
        if (providerAddress.includes('storage.datavault.space')) {
            chunkBaseUrl = 'https://storage.datavault.space/api/storage/files';
        } else {
            const base = providerAddress.startsWith('http') ? providerAddress : `https://${providerAddress}`;
            chunkBaseUrl = `${base}/api/storage/files`;
        }
        
        // Initialize MP4Box
        if (!window.MP4Box) {
            throw new Error('MP4Box.js library not loaded');
        }
        
        // Get total chunks (use provided chunkCount or fetch it)
        // chunkCount should be passed from the file list, but if not, try to get it from the indexer
        let totalChunks = chunkCount;
        
        if (!totalChunks || totalChunks < 1) {
            console.warn(`chunkCount param is ${chunkCount}, attempting to fetch from indexer...`);
            // Try to get chunk count from the file query response
            const fileData = downloadInfo.file || {};
            totalChunks = fileData.chunk_count || fileData.chunkCount;
            
            if (!totalChunks || totalChunks < 1) {
                // Last resort: try to get from storage provider header
                console.warn('chunk_count not in file data, trying storage provider header...');
                totalChunks = await getTotalChunks(chunkBaseUrl, merkleRoot);
            }
        }
        
        console.log(`Video player: totalChunks=${totalChunks}, chunkCount param=${chunkCount}, fileData.chunk_count=${downloadInfo.file?.chunk_count || downloadInfo.file?.chunkCount || 'not found'}`);
        
        if (totalChunks === 0) {
            throw new Error('No chunks available for this file');
        }
        
        if (statusElement) {
            statusElement.innerHTML = '<span class="text-info">Loading video segments...</span>';
        }
        
        // Helper function to download and decrypt a specific segment
        const downloadSegment = async (segmentIndex: number): Promise<Uint8Array> => {
            const url = `${chunkBaseUrl}/download?merkle_root=${merkleRoot}&chunk_index=${segmentIndex}`;
            
            if (statusElement) {
                statusElement.innerHTML = `<span class="text-info">Loading segment ${segmentIndex + 1} of ${totalChunks}...</span>`;
            }
            
            const response = await fetchWithTimeout(url, 30000, { method: 'GET' });
            
            if (!response.ok) {
                throw new Error(`Failed to load segment ${segmentIndex}: ${response.status}`);
            }
            
            const encryptedChunkData = await response.arrayBuffer();
            
            // Decrypt this chunk (each chunk is a single encrypted segment for DASH .m4s files)
            const decryptedSegments = await decryptEncryptedChunkData(
                new Uint8Array(encryptedChunkData),
                fileAesBundle
            );
            
            // For DASH segments, each chunk should decrypt to a single segment
            // Combine all decrypted segments from this chunk (should be just one for .m4s files)
            const totalLength = decryptedSegments.reduce((sum, seg) => sum + seg.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const segment of decryptedSegments) {
                combined.set(segment, offset);
                offset += segment.length;
            }
            
            return combined;
        };
        
        // Check if MediaSource is supported for streaming
        const MediaSource = window.MediaSource || (window as any).WebKitMediaSource;
        const supportsStreaming = MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42e01e,mp4a.40.2"');
        
        if (supportsStreaming) {
            console.log('MediaSource API supported - using progressive streaming');
            return playVideoWithStreaming(videoElement, statusElement, totalChunks, downloadSegment);
        } else {
            console.log('MediaSource API not supported - using full download approach');
        }
        
        // Full download approach (fallback or when MediaSource not supported)
        // Download all segments first
        const segments: Uint8Array[] = [];
        console.log(`Downloading ${totalChunks} segments...`);
            for (let i = 0; i < totalChunks; i++) {
            const segmentData = await downloadSegment(i);
            segments.push(segmentData);
            console.log(`Downloaded segment ${i + 1}/${totalChunks}: ${segmentData.length} bytes`);
        }
        console.log(`All segments downloaded. Total segments: ${segments.length}`);
        
        if (statusElement) {
            statusElement.innerHTML = '<span class="text-info">Reconstructing video file...</span>';
        }
        
        // Segments contain raw sample data, we need to:
        // 1. Extract file header from first segment (if present)
        // 2. Extract sample data from all segments
        // 3. Create a proper mdat box containing all sample data
        // 4. Combine: ftyp + moov + mdat
        
        // Separate header from sample data
        let fileHeader: Uint8Array | null = null;
        const allSampleData: Uint8Array[] = [];
        
        if (segments.length === 0) {
            throw new Error('No segments available');
        }
        
        // Process first segment - contains header (ftyp + moov) + raw sample data
        // Segments contain raw sample data (not wrapped in mdat boxes)
        // We need to parse the header boxes to find where it ends
        const firstSegment = segments[0];
        const firstSegmentView = new DataView(firstSegment.buffer, firstSegment.byteOffset, firstSegment.byteLength);
        
        // Check if first segment starts with ftyp (file header)
        if (firstSegment.length >= 8) {
            const ftypType = String.fromCharCode(
                firstSegmentView.getUint8(4),
                firstSegmentView.getUint8(5),
                firstSegmentView.getUint8(6),
                firstSegmentView.getUint8(7)
            );
            
            if (ftypType === 'ftyp') {
                // First segment starts with file header - parse boxes to find where header ends
                // Header should be: ftyp box + moov box, then sample data follows
                // MP4 uses big-endian for box sizes
                let pos = 0;
                let headerEnd = -1;
                let foundMoov = false;
                let moovStartPos = -1;
                let moovSize = -1;
                
                // Parse MP4 boxes to find the end of the header (end of moov box)
                while (pos < firstSegment.length - 8) {
                    const size = firstSegmentView.getUint32(pos, false); // big-endian
                    if (size === 0) {
                        // Invalid box size
                        headerEnd = pos;
                        break;
                    }
                    
                    // Check for large size (64-bit)
                    // MP4 uses big-endian for box sizes
                    let boxSize = size;
                    let dataStart = 8;
                    if (size === 1) {
                        // 64-bit size follows
                        if (pos + 16 > firstSegment.length) {
                            headerEnd = pos;
                            break;
                        }
                        const sizeHigh = firstSegmentView.getUint32(pos + 8, false); // big-endian
                        const sizeLow = firstSegmentView.getUint32(pos + 12, false); // big-endian
                        if (sizeHigh > 0 || sizeLow > firstSegment.length || pos + sizeLow > firstSegment.length) {
                            headerEnd = pos;
                            break;
                        }
                        boxSize = sizeLow;
                        dataStart = 16;
                    }
                    
                    if (pos + boxSize > firstSegment.length) {
                        // Box extends beyond segment - header ends here
                        headerEnd = pos;
                        break;
                    }
                    
                    const type = String.fromCharCode(
                        firstSegmentView.getUint8(pos + 4),
                        firstSegmentView.getUint8(pos + 5),
                        firstSegmentView.getUint8(pos + 6),
                        firstSegmentView.getUint8(pos + 7)
                    );
                    
                    if (type === 'ftyp') {
                        // First box - continue
                        pos += boxSize;
                    } else if (type === 'moov') {
                        // Found moov box - this is the last header box
                        foundMoov = true;
                        moovStartPos = pos;
                        moovSize = boxSize;
                        // Verify moov box size is valid
                        if (boxSize >= 8 && pos + boxSize <= firstSegment.length) {
                            // Complete moov box is in this segment
                            pos += boxSize;
                            // Header ends after moov box
                            headerEnd = pos;
                            console.log(`Found complete moov box: start=${moovStartPos}, size=${moovSize}, header ends at=${headerEnd}`);
                            break;
                        } else if (pos + boxSize > firstSegment.length) {
                            // Moov box extends beyond first segment - this shouldn't happen if header is complete
                            // But if it does, we need to include the entire moov box
                            console.warn(`Moov box extends beyond first segment (size=${boxSize}, available=${firstSegment.length - pos})`);
                            // Use the full moov box size even if it extends beyond
                            headerEnd = pos + boxSize;
                            // But cap it at segment length for safety
                            if (headerEnd > firstSegment.length) {
                                headerEnd = firstSegment.length;
                                console.error('WARNING: Moov box is incomplete in first segment! Header may be corrupted.');
                            }
                            break;
                        } else {
                            // Invalid moov box size - try to find end by searching for next box
                            console.warn(`Invalid moov box size: ${boxSize}, searching for next box`);
                            // Search forward for next box marker
                            for (let searchPos = pos + 8; searchPos < firstSegment.length - 8; searchPos += 4) {
                                const nextSize = firstSegmentView.getUint32(searchPos, false); // big-endian
                                if (nextSize >= 8 && nextSize < firstSegment.length && searchPos + nextSize <= firstSegment.length) {
                                    const nextType = String.fromCharCode(
                                        firstSegmentView.getUint8(searchPos + 4),
                                        firstSegmentView.getUint8(searchPos + 5),
                                        firstSegmentView.getUint8(searchPos + 6),
                                        firstSegmentView.getUint8(searchPos + 7)
                                    );
                                    // If we find a valid box type (not part of moov), header ends here
                                    if (nextType !== 'trak' && nextType !== 'tkhd' && nextType !== 'mdia' && 
                                        nextType !== 'minf' && nextType !== 'stbl' && nextType !== 'udta' &&
                                        nextType !== 'mvhd' && nextType !== 'iods') {
                                        headerEnd = searchPos;
                                        break;
                                    }
                                }
                            }
                            if (headerEnd < 0) {
                                // Couldn't find next box - assume moov ends at a reasonable position
                                headerEnd = Math.min(pos + 200000, firstSegment.length);
                            }
                            break;
                        }
                    } else if (type === 'mdat') {
                        // Found mdat box - header ends before this
                        headerEnd = pos;
                        break;
                    } else {
                        // Unknown box type after ftyp - might be sample data or another header box
                        // Common header boxes: free, skip, wide, uuid
                        const headerBoxTypes = ['free', 'skip', 'wide', 'uuid', 'pnot'];
                        if (headerBoxTypes.includes(type.toLowerCase())) {
                            // Known header box - continue
                            pos += boxSize;
                        } else if (foundMoov) {
                            // Found moov already, this must be sample data
                            headerEnd = pos;
                            break;
                        } else {
                            // Unknown box before moov - might be part of header or sample data
                            // Check if it looks like a valid box (reasonable size)
                            if (boxSize > 0 && boxSize < 1000000 && pos + boxSize <= firstSegment.length) {
                                // Looks like a valid box - might be part of header
                                pos += boxSize;
                            } else {
                                // Invalid box - probably sample data
                                headerEnd = pos;
                                break;
                            }
                        }
                    }
                }
                
                if (headerEnd > 0 && headerEnd < firstSegment.length) {
                    // Extract header and sample data
                    fileHeader = new Uint8Array(firstSegment.slice(0, headerEnd));
                    const firstSegmentSamples = new Uint8Array(firstSegment.slice(headerEnd));
                    if (firstSegmentSamples.length > 0) {
                        allSampleData.push(firstSegmentSamples);
                    }
                    
                    // Validate header structure
                    if (fileHeader.length >= 8) {
                        const headerView = new DataView(fileHeader.buffer);
                        const firstBoxType = String.fromCharCode(
                            headerView.getUint8(4),
                            headerView.getUint8(5),
                            headerView.getUint8(6),
                            headerView.getUint8(7)
                        );
                        if (firstBoxType !== 'ftyp') {
                            console.warn(`Header does not start with ftyp (found: ${firstBoxType}), header may be invalid`);
                        }
                        
                        // Check if moov box is present in header
                        let moovInHeader = false;
                        for (let h = 0; h < fileHeader.length - 8; h += 4) {
                            const hType = String.fromCharCode(
                                headerView.getUint8(h + 4),
                                headerView.getUint8(h + 5),
                                headerView.getUint8(h + 6),
                                headerView.getUint8(h + 7)
                            );
                            if (hType === 'moov') {
                                moovInHeader = true;
                                break;
                            }
                        }
                        
                        console.log(`Extracted header: ${fileHeader.length} bytes (found moov: ${foundMoov}, moov in header: ${moovInHeader}), first segment samples: ${firstSegmentSamples.length} bytes`);
                        
                        if (!moovInHeader && !foundMoov) {
                            console.error('WARNING: moov box not found in extracted header! Header may be incomplete.');
            }
                    }
                } else {
                    // Couldn't determine header end - need to find moov box more carefully
                    // Try searching for 'moov' string in the segment
                    let moovEnd = -1;
                    const searchStart = Math.min(100, firstSegment.length - 100); // Start after ftyp box
                    for (let i = searchStart; i < firstSegment.length - 8; i += 4) {
                        const type = String.fromCharCode(
                            firstSegmentView.getUint8(i + 4),
                            firstSegmentView.getUint8(i + 5),
                            firstSegmentView.getUint8(i + 6),
                            firstSegmentView.getUint8(i + 7)
                        );
                        if (type === 'moov') {
                            // Found moov box - get its size and find where it ends
                            // MP4 uses big-endian
                            const moovSize = firstSegmentView.getUint32(i, false); // big-endian
                            let actualMoovSize = moovSize;
                            if (moovSize === 1 && i + 16 <= firstSegment.length) {
                                // 64-bit size
                                actualMoovSize = firstSegmentView.getUint32(i + 12, false); // big-endian
                            }
                            moovEnd = i + actualMoovSize;
                            if (moovEnd <= firstSegment.length) {
                                headerEnd = moovEnd;
                                fileHeader = new Uint8Array(firstSegment.slice(0, headerEnd));
                                const firstSegmentSamples = new Uint8Array(firstSegment.slice(headerEnd));
                                if (firstSegmentSamples.length > 0) {
                                    allSampleData.push(firstSegmentSamples);
                                }
                                console.log(`Found moov box by search: header ${fileHeader.length} bytes, samples ${firstSegmentSamples.length} bytes`);
                                break;
                            }
                        }
                    }
                    
                    if (moovEnd < 0 || headerEnd < 0) {
                        // Still couldn't find it - this is a problem
                        // Try a different approach: assume header is reasonable size (max 2MB)
                        const maxHeaderSize = Math.min(2000000, Math.floor(firstSegment.length * 0.9));
                        if (firstSegment.length > maxHeaderSize) {
                            // Segment is very large - assume first portion is header
                            headerEnd = maxHeaderSize;
                            fileHeader = new Uint8Array(firstSegment.slice(0, headerEnd));
                            const firstSegmentSamples = new Uint8Array(firstSegment.slice(headerEnd));
                            if (firstSegmentSamples.length > 0) {
                                allSampleData.push(firstSegmentSamples);
                            }
                            console.warn(`Using estimated header size: ${headerEnd} bytes, samples: ${firstSegmentSamples.length} bytes`);
                        } else {
                            // Small segment - might be all header or all sample data
                            // Check if it looks like a valid header (starts with ftyp, has reasonable structure)
                            fileHeader = new Uint8Array(firstSegment);
                            console.warn(`Small first segment (${firstSegment.length} bytes), assuming entire segment is header. This may cause issues.`);
                        }
                    }
                }
            } else {
                // First segment doesn't start with ftyp - assume it's all sample data
                allSampleData.push(new Uint8Array(firstSegment));
                console.warn('First segment does not start with ftyp, treating as sample data');
            }
        } else {
            // Very small first segment - assume it's sample data
            allSampleData.push(new Uint8Array(firstSegment));
        }
        
        // Add remaining segments (all raw sample data)
        console.log(`Processing ${segments.length} total segments. First segment sample data: ${allSampleData.length > 0 ? allSampleData[0].length : 0} bytes`);
        for (let i = 1; i < segments.length; i++) {
            const segData = new Uint8Array(segments[i]);
            allSampleData.push(segData);
            console.log(`Added segment ${i} sample data: ${segData.length} bytes`);
        }
        
        // Combine all sample data
        const totalSampleDataLength = allSampleData.reduce((sum, seg) => sum + seg.length, 0);
        
        if (totalSampleDataLength === 0) {
            throw new Error('No sample data found in segments. Cannot reconstruct video file.');
        }
        
        console.log(`Combining ${allSampleData.length} sample data segments, total: ${totalSampleDataLength} bytes`);
        
        const combinedSampleData = new Uint8Array(totalSampleDataLength);
        let sampleOffset = 0;
        for (const seg of allSampleData) {
            combinedSampleData.set(seg, sampleOffset);
            sampleOffset += seg.length;
        }
        
        // Validate that we have a proper header before reconstructing
        if (!fileHeader || fileHeader.length < 32) {
            throw new Error(`Invalid file header: ${fileHeader ? fileHeader.length : 0} bytes. Cannot reconstruct MP4 file.`);
        }
        
        // Verify header starts with ftyp
        const headerView = new DataView(fileHeader.buffer);
        if (fileHeader.length >= 8) {
            const ftypCheck = String.fromCharCode(
                headerView.getUint8(4),
                headerView.getUint8(5),
                headerView.getUint8(6),
                headerView.getUint8(7)
            );
            if (ftypCheck !== 'ftyp') {
                throw new Error(`File header does not start with ftyp (found: ${ftypCheck}). Header may be corrupted.`);
            }
        }
        
        // Create mdat box: [4-byte size][4-byte type='mdat'][data]
        // MP4 uses big-endian (network byte order) for box sizes
        const mdatBoxSize = 8 + combinedSampleData.length;
        
        // Check for 32-bit size overflow (max 4GB)
        if (mdatBoxSize > 0xFFFFFFFF) {
            throw new Error(`mdat box too large: ${mdatBoxSize} bytes (max 4GB)`);
        }
        
        const mdatBox = new Uint8Array(mdatBoxSize);
        const mdatView = new DataView(mdatBox.buffer);
        // Use big-endian (false) for MP4 box sizes
        mdatView.setUint32(0, mdatBoxSize, false);
        mdatBox[4] = 'm'.charCodeAt(0);
        mdatBox[5] = 'd'.charCodeAt(0);
        mdatBox[6] = 'a'.charCodeAt(0);
        mdatBox[7] = 't'.charCodeAt(0);
        mdatBox.set(combinedSampleData, 8);
        
        // Combine: file header + mdat box
        const headerSize = fileHeader.length;
        const totalLength = headerSize + mdatBoxSize;
        const combinedBuffer = new Uint8Array(totalLength);
        combinedBuffer.set(fileHeader, 0);
        combinedBuffer.set(mdatBox, headerSize);
        
        console.log(`Reconstructed MP4: ${headerSize} bytes header + ${mdatBoxSize} bytes mdat (${combinedSampleData.length} bytes data) = ${totalLength} bytes total`);
            
        // Validate the combined buffer structure
        const combinedView = new DataView(combinedBuffer.buffer);
        if (combinedBuffer.length >= 16) {
            // Check first box (ftyp)
            const firstBoxSize = combinedView.getUint32(0, false); // big-endian
            const firstBoxType = String.fromCharCode(
                combinedView.getUint8(4),
                combinedView.getUint8(5),
                combinedView.getUint8(6),
                combinedView.getUint8(7)
            );
            
            // Check mdat box
            const mdatPos = headerSize;
            if (mdatPos + 8 <= combinedBuffer.length) {
                const mdatSize = combinedView.getUint32(mdatPos, false); // big-endian
                const mdatType = String.fromCharCode(
                    combinedView.getUint8(mdatPos + 4),
                    combinedView.getUint8(mdatPos + 5),
                    combinedView.getUint8(mdatPos + 6),
                    combinedView.getUint8(mdatPos + 7)
                );
                console.log(`Validated structure: first box=${firstBoxType} (${firstBoxSize} bytes), mdat=${mdatType} (${mdatSize} bytes) at offset ${mdatPos}`);
                
                if (mdatType !== 'mdat') {
                    throw new Error(`Invalid mdat box at position ${mdatPos}: found ${mdatType} instead of mdat`);
                }
                if (mdatSize !== mdatBoxSize) {
                    throw new Error(`mdat box size mismatch: expected ${mdatBoxSize}, found ${mdatSize}`);
                }
            }
        }
        
        // Try to parse with MP4Box first to validate the structure
        const mp4boxFile = window.MP4Box.createFile();
        
        return new Promise<void>((resolve, reject) => {
            let videoUrl: string | null = null;
            let mp4boxValidated = false;
            
            mp4boxFile.onReady = (info: any) => {
                console.log('MP4Box validated file structure:', info);
                mp4boxValidated = true;
                
                // MP4Box can parse it, so it should be a valid MP4
                // Create blob and play
                const blob = new Blob([combinedBuffer.buffer], { type: 'video/mp4' });
                videoUrl = URL.createObjectURL(blob);
                
                videoElement.src = videoUrl;
                        
                        const onLoadedMetadata = () => {
                    if (statusElement) {
                        statusElement.innerHTML = '<span class="text-success">Video ready</span>';
                        setTimeout(() => {
                            if (statusElement) {
                                statusElement.style.display = 'none';
                            }
                        }, 1000);
                    }
                            resolve();
                        };
                        
                const onError = (e: Event) => {
                    const error = videoElement.error;
                    let errorMsg = 'Video load error';
                    if (error) {
                        const errorMessages: { [key: number]: string } = {
                            1: 'MEDIA_ERR_ABORTED - The user aborted the loading',
                            2: 'MEDIA_ERR_NETWORK - A network error occurred',
                            3: 'MEDIA_ERR_DECODE - An error occurred while decoding',
                            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - The video format is not supported'
                        };
                        errorMsg = `Code ${error.code}: ${errorMessages[error.code] || 'Unknown error'}`;
                    }
                    reject(new Error(errorMsg));
                        };
                        
                        videoElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                        videoElement.addEventListener('error', onError, { once: true });
                        videoElement.load();
            };
            
            mp4boxFile.onError = (error: string) => {
                console.warn('MP4Box parsing error (will still attempt playback):', error);
                // Even if MP4Box can't parse it, try to play the combined buffer
                // The browser's video decoder might be more lenient
                if (!mp4boxValidated) {
                    console.log('Attempting to play combined segments despite MP4Box error...');
                    
                    const blob = new Blob([combinedBuffer.buffer], { type: 'video/mp4' });
                    videoUrl = URL.createObjectURL(blob);
                    videoElement.src = videoUrl;
                    
                    const onLoadedMetadata = () => {
                    if (statusElement) {
                        statusElement.innerHTML = '<span class="text-success">Video ready</span>';
                        setTimeout(() => {
                            if (statusElement) {
                                statusElement.style.display = 'none';
                            }
                        }, 1000);
                    }
                        resolve();
                    };
                    
                    const onError = (e: Event) => {
                        const error = videoElement.error;
                        let errorMsg = 'Video cannot be played - segments do not form a valid MP4 file. The file header may be missing or corrupted.';
                        if (error) {
                            errorMsg = `Code ${error.code}: ${errorMsg}`;
                        }
                        reject(new Error(errorMsg));
                    };
                    
                    videoElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                    videoElement.addEventListener('error', onError, { once: true });
                    videoElement.load();
            }
            };
            
            // Try to parse the combined buffer to validate structure
            const buffer = combinedBuffer.buffer;
            (buffer as any).fileStart = 0;
            mp4boxFile.appendBuffer(buffer);
            mp4boxFile.flush();
        });
            
        // Cleanup is already set up above
        
        // Wait for video to be ready
        videoElement.addEventListener('loadedmetadata', () => {
            if (statusElement && !statusElement.innerHTML.includes('ready')) {
                statusElement.innerHTML = '<span class="text-success">Video ready</span>';
                setTimeout(() => {
                    if (statusElement) {
                        statusElement.style.display = 'none';
                    }
                }, 1000);
            }
        }, { once: true });
        
        videoElement.addEventListener('canplay', () => {
            if (statusElement) {
                statusElement.style.display = 'none';
            }
        }, { once: true });
        
        // Also set up error handler for video element
        videoElement.addEventListener('error', (e) => {
            console.error('Video element error:', e);
            if (statusElement) {
                statusElement.innerHTML = '<span class="text-danger">Error playing video</span>';
            }
        });
        
    } catch (error) {
        console.error('Error loading video:', error);
        if (statusElement) {
            statusElement.innerHTML = `<span class="text-danger">Error: ${error instanceof Error ? error.message : 'Failed to load video'}</span>`;
        }
    }
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        // Clean up video element
        if (videoElement) {
            videoElement.pause();
            videoElement.src = '';
            videoElement.load();
        }
        $('#videoPlayerModal').remove();
    });
}

/**
 * Play video using MediaSource Extensions for progressive streaming
 */
async function playVideoWithStreaming(
    videoElement: HTMLVideoElement,
    statusElement: HTMLElement | null,
    totalChunks: number,
    downloadSegment: (index: number) => Promise<Uint8Array>
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const MediaSource = window.MediaSource || (window as any).WebKitMediaSource;
        
        const mediaSource = new MediaSource();
        const videoUrl = URL.createObjectURL(mediaSource);
        videoElement.src = videoUrl;
        
        let sourceBuffer: SourceBuffer | null = null;
        let initializationSegment: ArrayBuffer | null = null;
        let segmentIndex = 0;
        let isAppending = false;
        let segmentsQueue: ArrayBuffer[] = [];
        let hasStartedPlaying = false;
        let mp4boxFile: any = null;
        
        mediaSource.addEventListener('sourceopen', async () => {
            try {
                // Check MediaSource state
                if (mediaSource.readyState !== 'open') {
                    throw new Error(`MediaSource not open, state: ${mediaSource.readyState}`);
                }
                
                if (statusElement) {
                    statusElement.innerHTML = '<span class="text-info">Initializing video stream...</span>';
                }
                
                // Download first segment to get initialization segment (header)
                console.log('Downloading initialization segment (segment 0)...');
                const firstSegment = await downloadSegment(0);
                
                // Check MediaSource state again after async operation
                if (mediaSource.readyState !== 'open') {
                    throw new Error(`MediaSource closed during download, state: ${mediaSource.readyState}`);
                }
                
                // Extract header from first segment
                const { header, sampleData } = extractHeaderFromSegment(firstSegment);
                if (!header) {
                    throw new Error('Failed to extract initialization segment from first segment');
                }
                
                // Create a new ArrayBuffer from the header data (ensure it's not detached)
                const headerCopy = new Uint8Array(header.length);
                headerCopy.set(header);
                initializationSegment = headerCopy.buffer;
                
                // Use MP4Box to parse the initialization segment and get codec info
                mp4boxFile = window.MP4Box.createFile();
                let codecString = 'video/mp4; codecs="avc1.42e01e,mp4a.40.2"'; // Default
                
                mp4boxFile.onReady = (info: any) => {
                    try {
                        // Check MediaSource state before creating SourceBuffer
                        if (mediaSource.readyState !== 'open') {
                            console.error(`MediaSource not open when creating SourceBuffer, state: ${mediaSource.readyState}`);
                            reject(new Error('MediaSource closed before SourceBuffer creation'));
                            return;
                        }
                        
                        console.log('MP4Box parsed init segment:', info);
                        // Build codec string from track info
                        const videoTrack = info.tracks.find((t: any) => t.type === 'video');
                        const audioTrack = info.tracks.find((t: any) => t.type === 'audio');
                        
                        if (videoTrack && videoTrack.codec) {
                            const codecs: string[] = [videoTrack.codec];
                            if (audioTrack && audioTrack.codec) {
                                codecs.push(audioTrack.codec);
                            }
                            codecString = `video/mp4; codecs="${codecs.join(',')}"`;
                            console.log('Detected codec string:', codecString);
                        }
                        
                        // Create SourceBuffer with detected codec
                        if (!MediaSource.isTypeSupported(codecString)) {
                            console.warn(`Codec ${codecString} not supported, trying default`);
                            codecString = 'video/mp4; codecs="avc1.42e01e"';
                        }
                        
                        if (!MediaSource.isTypeSupported(codecString)) {
                            reject(new Error(`Codec not supported: ${codecString}`));
                            return;
                        }
                        
                        // Check MediaSource state again
                        if (mediaSource.readyState !== 'open') {
                            reject(new Error('MediaSource closed before adding SourceBuffer'));
                            return;
                        }
                        
                        sourceBuffer = mediaSource.addSourceBuffer(codecString);
                        console.log('SourceBuffer created with codec:', codecString);
                        
                        // Set up SourceBuffer event handlers
                        sourceBuffer.addEventListener('updateend', onUpdateEnd);
                        sourceBuffer.addEventListener('error', (e) => {
                            console.error('SourceBuffer error:', e);
                            reject(new Error('SourceBuffer error during streaming'));
                        });
                        
                        // Append initialization segment
                        if (sourceBuffer && !sourceBuffer.updating && mediaSource.readyState === 'open') {
                            // Create a fresh copy of the buffer to ensure it's not detached
                            const initBufferCopy = new Uint8Array(initializationSegment!);
                            isAppending = true;
                            sourceBuffer.appendBuffer(initBufferCopy.buffer);
                        }
                    } catch (err) {
                        console.error('Error in onReady callback:', err);
                        reject(err);
                    }
                };
                
                mp4boxFile.onError = (error: string) => {
                    console.warn('MP4Box error parsing init segment:', error);
                    // Try with default codec
                    codecString = 'video/mp4; codecs="avc1.42e01e,mp4a.40.2"';
                    
                    try {
                        if (mediaSource.readyState !== 'open') {
                            reject(new Error('MediaSource closed'));
                            return;
                        }
                        
                        if (MediaSource.isTypeSupported(codecString)) {
                            sourceBuffer = mediaSource.addSourceBuffer(codecString);
                            sourceBuffer.addEventListener('updateend', onUpdateEnd);
                            sourceBuffer.addEventListener('error', (e) => {
                                console.error('SourceBuffer error:', e);
                                reject(new Error('SourceBuffer error'));
                            });
                            if (sourceBuffer && !sourceBuffer.updating && mediaSource.readyState === 'open') {
                                const initBufferCopy = new Uint8Array(initializationSegment!);
                                isAppending = true;
                                sourceBuffer.appendBuffer(initBufferCopy.buffer);
                            }
                        } else {
                            reject(new Error('Failed to create SourceBuffer with supported codec'));
                        }
                    } catch (err) {
                        console.error('Error in onError callback:', err);
                        reject(err);
                    }
                };
                
                // Parse initialization segment with MP4Box
                const initBuffer = initializationSegment;
                (initBuffer as any).fileStart = 0;
                mp4boxFile.appendBuffer(initBuffer);
                mp4boxFile.flush();
                
                // Start downloading remaining segments
                segmentIndex = 1;
                downloadNextSegment();
                
            } catch (error) {
                console.error('Error setting up streaming:', error);
                reject(error);
            }
        });
        
        mediaSource.addEventListener('error', (e) => {
            console.error('MediaSource error:', e);
            reject(new Error('MediaSource error'));
        });
        
        videoElement.addEventListener('error', (e) => {
            const error = videoElement.error;
            let errorMsg = 'Video playback error';
            if (error) {
                const errorMessages: { [key: number]: string } = {
                    1: 'MEDIA_ERR_ABORTED',
                    2: 'MEDIA_ERR_NETWORK',
                    3: 'MEDIA_ERR_DECODE',
                    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                };
                errorMsg = `Code ${error.code}: ${errorMessages[error.code] || 'Unknown error'}`;
            }
            reject(new Error(errorMsg));
        });
        
        async function onUpdateEnd() {
            isAppending = false;
            
            // Start playing once we have initialization segment and first media segment
            if (!hasStartedPlaying && videoElement.readyState >= 2 && segmentsQueue.length > 0) {
                hasStartedPlaying = true;
                if (statusElement) {
                    statusElement.innerHTML = '<span class="text-success">Video ready</span>';
                    setTimeout(() => {
                        if (statusElement) {
                            statusElement.style.display = 'none';
                        }
                    }, 1000);
                }
                resolve();
            }
            
            // Append queued segments
            if (segmentsQueue.length > 0 && sourceBuffer && !sourceBuffer.updating) {
                const segment = segmentsQueue.shift()!;
                try {
                    isAppending = true;
                    sourceBuffer.appendBuffer(segment);
                } catch (e) {
                    console.error('Error appending segment:', e);
                    isAppending = false;
                }
            }
            
            // Check if we need more segments
            if (segmentIndex < totalChunks) {
                // Continue downloading segments
                downloadNextSegment();
            } else if (segmentsQueue.length === 0 && !isAppending) {
                // All segments downloaded and appended
                if (mediaSource.readyState === 'open') {
                    mediaSource.endOfStream();
                }
            }
        }
        
        async function downloadNextSegment() {
            if (segmentIndex >= totalChunks) {
                return;
            }
            
            try {
                if (statusElement && segmentIndex % 5 === 0) {
                    statusElement.innerHTML = `<span class="text-info">Buffering... ${segmentIndex}/${totalChunks} segments</span>`;
                }
                
                const segmentData = await downloadSegment(segmentIndex);
                const { header, sampleData } = extractHeaderFromSegment(segmentData);
                
                // For segments after the first, we only need the sample data
                // Create a media segment (mdat box) with the sample data
                const mediaSegment = createMediaSegment(sampleData);
                
                // Queue segment for appending
                segmentsQueue.push(mediaSegment);
                
                // Try to append if not already appending
                if (!isAppending && sourceBuffer && !sourceBuffer.updating && segmentsQueue.length > 0) {
                    const segment = segmentsQueue.shift()!;
                    isAppending = true;
                    sourceBuffer.appendBuffer(segment);
                }
                
                segmentIndex++;
                
                // Continue downloading next segment (don't wait)
                if (segmentIndex < totalChunks) {
                    downloadNextSegment();
                }
            } catch (error) {
                console.error(`Error downloading segment ${segmentIndex}:`, error);
                // Continue with next segment
                segmentIndex++;
                if (segmentIndex < totalChunks) {
                    downloadNextSegment();
                }
            }
        }
    });
}

/**
 * Extract header and sample data from a segment
 */
function extractHeaderFromSegment(segment: Uint8Array): { header: Uint8Array | null; sampleData: Uint8Array } {
    const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
    
    if (segment.length < 8) {
        return { header: null, sampleData: segment };
    }
    
    const ftypType = String.fromCharCode(
        view.getUint8(4),
        view.getUint8(5),
        view.getUint8(6),
        view.getUint8(7)
    );
    
    if (ftypType === 'ftyp') {
        // Find where header ends (after moov)
        let pos = 0;
        let headerEnd = -1;
        
        while (pos < segment.length - 8) {
            const size = view.getUint32(pos, false);
            if (size === 0 || size > segment.length) break;
            
            let boxSize = size;
            if (size === 1 && pos + 16 <= segment.length) {
                boxSize = view.getUint32(pos + 12, false);
            }
            
            if (pos + boxSize > segment.length) break;
            
            const type = String.fromCharCode(
                view.getUint8(pos + 4),
                view.getUint8(pos + 5),
                view.getUint8(pos + 6),
                view.getUint8(pos + 7)
            );
            
            if (type === 'moov') {
                headerEnd = pos + boxSize;
                break;
            } else if (type === 'mdat') {
                headerEnd = pos;
                break;
            }
            
            pos += boxSize;
        }
        
        if (headerEnd > 0 && headerEnd < segment.length) {
            return {
                header: new Uint8Array(segment.slice(0, headerEnd)),
                sampleData: new Uint8Array(segment.slice(headerEnd))
            };
        }
    }
    
    return { header: null, sampleData: segment };
}

/**
 * Create a media segment (mdat box) from sample data
 */
function createMediaSegment(sampleData: Uint8Array): ArrayBuffer {
    // Create mdat box: [4-byte size][4-byte type='mdat'][data]
    const mdatSize = 8 + sampleData.length;
    const mdatBox = new Uint8Array(mdatSize);
    const mdatView = new DataView(mdatBox.buffer);
    mdatView.setUint32(0, mdatSize, false); // big-endian
    mdatBox[4] = 'm'.charCodeAt(0);
    mdatBox[5] = 'd'.charCodeAt(0);
    mdatBox[6] = 'a'.charCodeAt(0);
    mdatBox[7] = 't'.charCodeAt(0);
    mdatBox.set(sampleData, 8);
    
    return mdatBox.buffer;
}

/**
 * Get total number of chunks for the file
 */
async function getTotalChunks(chunkBaseUrl: string, merkleRoot: string): Promise<number> {
    try {
        // Try to get chunk 0 to get headers with total chunks info
        const response = await fetchWithTimeout(
            `${chunkBaseUrl}/download?merkle_root=${merkleRoot}&chunk_index=0`,
            10000,
            { method: 'GET' }
        );
        
        const totalChunksHeader = response.headers.get('X-Total-Chunks');
        if (totalChunksHeader) {
            return parseInt(totalChunksHeader, 10);
        }
        
        // If header not available, try to determine from response
        // For now, we'll use a reasonable default or try to fetch until we get 404
        return 1; // Will be updated as we discover chunks
    } catch (error) {
        console.warn('Could not determine total chunks, defaulting to 1:', error);
        return 1;
    }
}

/**
 * Stream video chunks sequentially: download, decrypt, and call callback with each decrypted chunk
 */
async function streamChunksSequentially(
    chunkBaseUrl: string,
    merkleRoot: string,
    totalChunks: number,
    fileAesBundle: any,
    onChunkDecrypted: (decryptedData: Uint8Array) => Promise<void> | void,
    statusElement: HTMLElement | null
): Promise<void> {
    let chunkIndex = 0;
    
    // Load and stream chunks (chunk_index starts from 0)
    while (chunkIndex < totalChunks) {
        try {
            const url = `${chunkBaseUrl}/download?merkle_root=${merkleRoot}&chunk_index=${chunkIndex}`;
            
            if (statusElement) {
                statusElement.innerHTML = `<span class="text-info">Loading chunk ${chunkIndex + 1}${totalChunks > 1 ? ` of ${totalChunks}` : ''}...</span>`;
            }
            
            const response = await fetchWithTimeout(url, 30000, { method: 'GET' });
            
            if (response.status === 404) {
                // No more chunks
                break;
            }
            
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkIndex}: ${response.status}`);
            }
            
            const encryptedChunkData = await response.arrayBuffer();
            
            // Decrypt this chunk (each chunk from storage provider contains one or more encrypted segments)
            if (statusElement) {
                statusElement.innerHTML = `<span class="text-info">Decrypting chunk ${chunkIndex + 1}${totalChunks > 1 ? ` of ${totalChunks}` : ''}...</span>`;
            }
            
            // Decrypt all encrypted segments in this chunk
            const decryptedSegments = await decryptEncryptedChunkData(
                new Uint8Array(encryptedChunkData),
                fileAesBundle
            );
            
            // Call callback with each decrypted segment
            for (const segment of decryptedSegments) {
                await onChunkDecrypted(segment);
            }
            
            chunkIndex++;
            
            // Update total chunks if we get it from header
            const totalChunksHeader = response.headers.get('X-Total-Chunks');
            if (totalChunksHeader) {
                const newTotal = parseInt(totalChunksHeader, 10);
                if (newTotal > totalChunks) {
                    totalChunks = newTotal;
                }
            }
        } catch (error) {
            if (chunkIndex === 0) {
                throw error; // Can't continue without first chunk
            }
            // For subsequent chunks, break on error (might be end of file)
            console.warn(`Error loading chunk ${chunkIndex}:`, error);
            break;
        }
    }
    
    if (chunkIndex === 0) {
        throw new Error('No chunks loaded');
    }
}

/**
 * Decrypt encrypted chunk data (may contain multiple encrypted segments)
 * Format: [8-byte size header][12-byte IV][encrypted data + 16-byte tag]...
 */
async function decryptEncryptedChunkData(
    encryptedData: Uint8Array,
    aesBundle: any
): Promise<Uint8Array[]> {
    const decryptedSegments: Uint8Array[] = [];
    let offset = 0;
    
    // Decrypt all segments in this chunk
    while (offset < encryptedData.length) {
        // Read 8-byte size header
        if (offset + 8 > encryptedData.length) {
            throw new Error('Invalid encrypted chunk: incomplete size header');
        }
        
        const sizeHeaderBytes = encryptedData.slice(offset, offset + 8);
        const sizeHeader = new TextDecoder().decode(sizeHeaderBytes);
        const chunkSize = parseInt(sizeHeader, 10);
        
        if (isNaN(chunkSize) || chunkSize <= 0) {
            throw new Error(`Invalid chunk size header: ${sizeHeader}`);
        }
        
        offset += 8;
        
        // Validate we have enough data for this chunk
        if (offset + chunkSize > encryptedData.length) {
            throw new Error(`Invalid encrypted chunk: incomplete chunk (expected ${chunkSize} bytes)`);
        }
        
        // Extract IV (12 bytes) and encrypted chunk + tag
        const chunkData = encryptedData.slice(offset, offset + chunkSize);
        const iv = chunkData.slice(0, 12);
        const ciphertextWithTag = chunkData.slice(12);
        
        // Validate ciphertext size (must have at least 16 bytes for authentication tag)
        if (ciphertextWithTag.length < 16) {
            throw new Error('Encrypted chunk is too small (missing authentication tag)');
        }
        
        // Decrypt chunk with AES-GCM (automatically verifies authentication tag)
        const decryptedChunkData = await crypto.subtle.decrypt(
            { 
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128 // 16 bytes = 128 bits
            },
            aesBundle.key,
            ciphertextWithTag
        );
        
        decryptedSegments.push(new Uint8Array(decryptedChunkData));
        offset += chunkSize;
    }
    
    return decryptedSegments;
}
