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
    
    try {
        console.log('=== Video Player Modal Opened ===');
        console.log('merkleRoot:', merkleRoot);
        console.log('fileName:', fileName);
        console.log('extraData parameter:', extraData);
        console.log('extraData type:', typeof extraData);
        console.log('extraData length:', extraData?.length || 0);
        console.log('chunkCount parameter:', chunkCount);
        
        // Parse MPEG-DASH manifest from extraData
        if (!extraData) {
            console.error('MPEG-DASH manifest not found - extraData is empty or undefined');
            console.error('All parameters received:', { merkleRoot, fileName, extraData, chunkCount });
            throw new Error('MPEG-DASH manifest not found in file metadata');
        }
        
        console.log('extraData starts with <?xml:', extraData.startsWith('<?xml'));
        console.log('extraData includes MPD:', extraData.includes('MPD'));
        console.log('extraData first 200 chars:', extraData.substring(0, 200));
        
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
        const totalChunks = chunkCount || await getTotalChunks(chunkBaseUrl, merkleRoot);
        
        // Download last chunk first (contains moov atom/metadata), then remaining chunks in order
        if (totalChunks === 0) {
            throw new Error('No chunks available for this file');
        }
        
        if (statusElement) {
            statusElement.innerHTML = '<span class="text-info">Loading video metadata...</span>';
        }
        
        const decryptedChunks: (Uint8Array | null)[] = new Array(totalChunks).fill(null);
        let chunksLoaded = 0;
        let videoStarted = false;
        let currentBlobUrl: string | null = null;
        
        // Helper function to download and decrypt a specific chunk
        const downloadChunk = async (chunkIndex: number): Promise<Uint8Array> => {
            const url = `${chunkBaseUrl}/download?merkle_root=${merkleRoot}&chunk_index=${chunkIndex}`;
            
            if (statusElement && !videoStarted) {
                statusElement.innerHTML = `<span class="text-info">Loading chunk ${chunkIndex + 1} of ${totalChunks}...</span>`;
            }
            
            const response = await fetchWithTimeout(url, 30000, { method: 'GET' });
            
            if (!response.ok) {
                throw new Error(`Failed to load chunk ${chunkIndex}: ${response.status}`);
            }
            
            const encryptedChunkData = await response.arrayBuffer();
            
            // Decrypt this chunk
            const decryptedSegments = await decryptEncryptedChunkData(
                new Uint8Array(encryptedChunkData),
                fileAesBundle
            );
            
            // Combine all segments from this chunk into one
            const totalLength = decryptedSegments.reduce((sum, seg) => sum + seg.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const segment of decryptedSegments) {
                combined.set(segment, offset);
                offset += segment.length;
            }
            
            return combined;
        };
        
        // Helper function to update video with current chunks (only when all chunks are available)
        const updateVideo = async () => {
            // Check if we have all chunks
            const hasAllChunks = decryptedChunks.every(chunk => chunk !== null);
            
            if (!hasAllChunks) {
                // Update progress but don't try to play yet
                if (statusElement && !videoStarted) {
                    statusElement.innerHTML = `<span class="text-info">Loading... (${chunksLoaded}/${totalChunks} chunks)</span>`;
                }
                return;
            }
            
            // All chunks available - combine them in order (0, 1, 2, ..., last)
            const orderedChunks: Uint8Array[] = [];
            for (let i = 0; i < totalChunks; i++) {
                orderedChunks.push(decryptedChunks[i]!);
            }
            
            // Combine all chunks in order
            const totalLength = orderedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combinedBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of orderedChunks) {
                combinedBuffer.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Create blob URL
            const arrayBuffer = combinedBuffer.buffer instanceof ArrayBuffer 
                ? combinedBuffer.buffer 
                : new Uint8Array(combinedBuffer).buffer;
            const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
            
            // Revoke old blob URL
            if (currentBlobUrl) {
                URL.revokeObjectURL(currentBlobUrl);
            }
            
            // Create new blob URL
            currentBlobUrl = URL.createObjectURL(blob);
            
            // Update video source
            if (videoElement.src !== currentBlobUrl) {
                videoElement.src = currentBlobUrl;
            }
            
            // Try to load metadata if not started yet
            if (!videoStarted) {
                try {
                    await new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
                        
                        const onLoadedMetadata = () => {
                            clearTimeout(timeout);
                            videoStarted = true;
                            resolve();
                        };
                        
                        const onError = () => {
                            clearTimeout(timeout);
                            reject(new Error('Video load error'));
                        };
                        
                        videoElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                        videoElement.addEventListener('error', onError, { once: true });
                        videoElement.load();
                    });
                    
                    // Video metadata loaded successfully
                    if (statusElement) {
                        statusElement.innerHTML = '<span class="text-success">Video ready</span>';
                        setTimeout(() => {
                            if (statusElement) {
                                statusElement.style.display = 'none';
                            }
                        }, 1000);
                    }
                } catch (e) {
                    console.error('Error loading video metadata:', e);
                    if (statusElement) {
                        statusElement.innerHTML = `<span class="text-danger">Error loading video: ${e instanceof Error ? e.message : 'Unknown error'}</span>`;
                    }
                }
            }
        };
        
        // Step 1: Download last chunk first (contains metadata)
        const lastChunkIndex = totalChunks - 1;
        try {
            const lastChunkData = await downloadChunk(lastChunkIndex);
            decryptedChunks[lastChunkIndex] = lastChunkData;
            chunksLoaded++;
        } catch (error) {
            throw new Error(`Failed to load last chunk (metadata): ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Step 2: Download remaining chunks in order (0 to totalChunks-2)
        // Download sequentially to maintain order, but we already have metadata from last chunk
        for (let i = 0; i < totalChunks - 1; i++) {
            const chunkIndex = i;
            try {
                const decryptedData = await downloadChunk(chunkIndex);
                decryptedChunks[chunkIndex] = decryptedData;
                chunksLoaded++;
                
                // Update video after each chunk (will only play when all chunks are available)
                await updateVideo();
            } catch (error) {
                console.error(`Error loading chunk ${chunkIndex}:`, error);
                throw error;
            }
        }
        
        // Final update to ensure video is ready (all chunks should be available now)
        await updateVideo();
        
        // Cleanup blob URL when modal closes
        const modal = document.getElementById('videoPlayerModal');
        if (modal) {
            const cleanup = () => {
                if (currentBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = null;
                }
            };
            
            modal.addEventListener('hidden.bs.modal', cleanup, { once: true });
        }
        
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

