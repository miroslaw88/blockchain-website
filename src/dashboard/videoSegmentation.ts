// Video segmentation using MP4Box.js to create fragmented MP4 (fMP4) segments

import { createFile, ISOFile } from 'mp4box';

export interface VideoSegment {
    data: ArrayBuffer;
    index: number;
    duration: number; // in seconds
    filename: string; // e.g., "init.mp4" or "segment_0001.m4s"
    isInitSegment?: boolean; // true for initialization segment
}

/**
 * Segments a video file into fragmented MP4 (fMP4) format
 * Creates one initialization segment (init.mp4) and multiple media segments (segment_XXXX.m4s)
 * Each media segment contains moof + mdat boxes and is independently playable
 * @param videoFile - The video file to segment
 * @returns Promise that resolves to an array of video segments
 *          First segment is the initialization segment (init.mp4), rest are media segments
 */
export async function segmentVideoIntoM4S(videoFile: File): Promise<VideoSegment[]> {
    return new Promise((resolve, reject) => {
        const segments: VideoSegment[] = [];
        const segmentDuration = 4; // 4 seconds per segment
        
        // Create MP4Box file instance
        const mp4boxFile = createFile();
        
        let fileBuffer: ArrayBuffer | null = null;
        let fileInfo: any | null = null;
        let initSegment: ArrayBuffer | null = null;
        
        // Error handler
        mp4boxFile.onError = (error: string) => {
            console.error('MP4Box error:', error);
            reject(new Error(`MP4Box segmentation error: ${error}`));
        };
        
        // Called when file is ready
        mp4boxFile.onReady = (info: any) => {
            console.log('MP4Box file ready:', info);
            fileInfo = info;
            
            // Get the video track
            const videoTrack = info.tracks.find((track: any) => track.type === 'video');
            if (!videoTrack) {
                reject(new Error('No video track found in file'));
                return;
            }
            
            // Create initialization segment (ftyp + moov)
            createInitSegment();
        };
        
        /**
         * Creates the initialization segment (ftyp + moov)
         */
        function createInitSegment() {
            if (!fileBuffer || !fileInfo) {
                reject(new Error('File buffer or info not available'));
                return;
            }
            
            // Extract ftyp and moov boxes from the original file
            const view = new DataView(fileBuffer);
            let pos = 0;
            let ftypStart = -1;
            let ftypSize = 0;
            let moovStart = -1;
            let moovSize = 0;
            
            // Find ftyp box
            while (pos < fileBuffer.byteLength - 8) {
                const size = view.getUint32(pos, false);
                if (size === 0) break;
                
                let boxSize = size;
                if (size === 1 && pos + 16 <= fileBuffer.byteLength) {
                    boxSize = view.getUint32(pos + 12, false);
                }
                
                if (pos + boxSize > fileBuffer.byteLength) break;
                
                const type = String.fromCharCode(
                    view.getUint8(pos + 4),
                    view.getUint8(pos + 5),
                    view.getUint8(pos + 6),
                    view.getUint8(pos + 7)
                );
                
                if (type === 'ftyp') {
                    ftypStart = pos;
                    ftypSize = boxSize;
                    pos += boxSize;
                } else if (type === 'moov') {
                    moovStart = pos;
                    moovSize = boxSize;
                    pos += boxSize;
                    break;
                } else if (type === 'mdat') {
                    // Stop before mdat
                    break;
                } else {
                    pos += boxSize;
                }
            }
            
            // If moov not found before mdat, search after mdat
            if (moovStart < 0) {
                let searchPos = 0;
                while (searchPos < fileBuffer.byteLength - 8) {
                    const size = view.getUint32(searchPos, false);
                    if (size === 0) {
                        searchPos += 4;
                        continue;
                    }
                    
                    let boxSize = size;
                    if (size === 1 && searchPos + 16 <= fileBuffer.byteLength) {
                        boxSize = view.getUint32(searchPos + 12, false);
                    }
                    
                    if (searchPos + boxSize > fileBuffer.byteLength) break;
                    
                    const type = String.fromCharCode(
                        view.getUint8(searchPos + 4),
                        view.getUint8(searchPos + 5),
                        view.getUint8(searchPos + 6),
                        view.getUint8(searchPos + 7)
                    );
                    
                    if (type === 'moov') {
                        moovStart = searchPos;
                        moovSize = boxSize;
                        break;
                    }
                    
                    searchPos += boxSize;
                }
            }
            
            if (ftypStart < 0 || moovStart < 0) {
                reject(new Error('Failed to find ftyp or moov boxes for initialization segment'));
                return;
            }
            
            // Combine ftyp and moov into init segment
            const ftypBox = fileBuffer.slice(ftypStart, ftypStart + ftypSize);
            const moovBox = fileBuffer.slice(moovStart, moovStart + moovSize);
            
            const initSegmentSize = ftypBox.byteLength + moovBox.byteLength;
            const initSegmentBuffer = new Uint8Array(initSegmentSize);
            initSegmentBuffer.set(new Uint8Array(ftypBox), 0);
            initSegmentBuffer.set(new Uint8Array(moovBox), ftypBox.byteLength);
            
            initSegment = initSegmentBuffer.buffer;
            
            // Add init segment
            segments.push({
                data: initSegment,
                index: 0,
                duration: 0,
                filename: 'init.mp4',
                isInitSegment: true
            });
            
            console.log(`Created initialization segment: ${initSegment.byteLength} bytes (ftyp: ${ftypSize} bytes, moov: ${moovSize} bytes)`);
            
            // Now create media segments
            createMediaSegments();
        }
        
        /**
         * Creates media segments (moof + mdat) for each 4-second interval
         * Extracts ALL data from the mdat box, not just samples
         */
        function createMediaSegments() {
            if (!fileBuffer || !fileInfo) {
                reject(new Error('File buffer or info not available'));
                return;
            }
            
            const videoTrack = fileInfo.tracks.find((track: any) => track.type === 'video');
            if (!videoTrack) {
                reject(new Error('Video track not found'));
                return;
            }
            
            // Find mdat box and extract ALL its data
            const view = new DataView(fileBuffer);
            let mdatStart = -1;
            let mdatSize = 0;
            let pos = 0;
            
            while (pos < fileBuffer.byteLength - 8) {
                const size = view.getUint32(pos, false);
                if (size === 0) break;
                
                let boxSize = size;
                if (size === 1 && pos + 16 <= fileBuffer.byteLength) {
                    boxSize = view.getUint32(pos + 12, false);
                }
                
                if (pos + boxSize > fileBuffer.byteLength) break;
                
                const type = String.fromCharCode(
                    view.getUint8(pos + 4),
                    view.getUint8(pos + 5),
                    view.getUint8(pos + 6),
                    view.getUint8(pos + 7)
                );
                
                if (type === 'mdat') {
                    mdatStart = pos;
                    mdatSize = boxSize;
                    break;
                }
                
                pos += boxSize;
            }
            
            if (mdatStart < 0) {
                reject(new Error('mdat box not found'));
                return;
            }
            
            const mdatDataStart = mdatStart + 8; // Skip mdat box header
            const mdatDataEnd = mdatStart + mdatSize;
            const mdatDataSize = mdatDataEnd - mdatDataStart;
            
            console.log(`mdat box: start=${mdatStart}, size=${mdatSize}, data: ${mdatDataStart} to ${mdatDataEnd} (${mdatDataSize} bytes)`);
            
            // Extract ALL data from mdat box
            const completeMdatData = new Uint8Array(fileBuffer.slice(mdatDataStart, mdatDataEnd));
            console.log(`Extracted complete mdat box data: ${completeMdatData.length} bytes`);
            
            const timescale = videoTrack.timescale;
            const segmentDurationInTimescale = segmentDuration * timescale;
            const totalDuration = fileInfo.duration;
            
            // Get all samples to map time to byte positions
            const allSamples: any[] = [];
            const file = mp4boxFile as any;
            if (file.moov && file.moov.traks) {
                const trak = file.moov.traks.find((t: any) => t.tkhd?.track_id === videoTrack.id);
                if (trak && trak.samples && trak.samples.length > 0) {
                    allSamples.push(...trak.samples);
                }
            }
            
            if (allSamples.length === 0) {
                let sampleIndex = 0;
                while (true) {
                    try {
                        const sample = mp4boxFile.getSample(videoTrack.id, sampleIndex);
                        if (!sample) break;
                        allSamples.push(sample);
                        sampleIndex++;
                    } catch (e) {
                        break;
                    }
                }
            }
            
            if (allSamples.length === 0) {
                reject(new Error('No samples found in video track'));
                return;
            }
            
            console.log(`Found ${allSamples.length} samples total`);
            
            // Map samples to byte positions within mdat box
            const samplesWithBytePos: Array<{ sample: any; bytePos: number; time: number }> = [];
            for (const sample of allSamples) {
                if (sample.offset >= mdatDataStart && sample.offset < mdatDataEnd) {
                    const bytePos = sample.offset - mdatDataStart;
                    const time = sample.cts || sample.dts || 0;
                    samplesWithBytePos.push({ sample, bytePos, time });
                }
            }
            
            // Sort by time
            samplesWithBytePos.sort((a, b) => a.time - b.time);
            
            // Group samples by time and extract ALL data in each segment's byte range
            let segmentIndex = 1;
            let currentSegmentStartTime = 0;
            let currentSegmentSamples: any[] = [];
            let currentSegmentStartByte = -1;
            let currentSegmentEndByte = -1;
            
            for (let i = 0; i < samplesWithBytePos.length; i++) {
                const { sample, bytePos, time } = samplesWithBytePos[i];
                const sampleEndByte = bytePos + sample.size;
                
                // Check if we've reached the next segment boundary
                const shouldCreateSegment = 
                    time >= currentSegmentStartTime + segmentDurationInTimescale || 
                    i === samplesWithBytePos.length - 1;
                
                if (shouldCreateSegment && currentSegmentSamples.length > 0) {
                    // Determine byte range for this segment
                    const firstSampleByte = currentSegmentStartByte >= 0 ? currentSegmentStartByte : samplesWithBytePos[i - currentSegmentSamples.length].bytePos;
                    const lastSampleEnd = currentSegmentEndByte >= 0 ? currentSegmentEndByte : (samplesWithBytePos[i - 1].bytePos + samplesWithBytePos[i - 1].sample.size);
                    
                    // Extract ALL data in this byte range (including gaps)
                    const segmentMdatData = completeMdatData.slice(
                        Math.max(0, firstSampleByte),
                        Math.min(completeMdatData.length, lastSampleEnd)
                    );
                    
                    // Create media segment (moof + mdat) with complete data
                    const segmentData = createMediaSegmentFromMdatData(
                        currentSegmentSamples,
                        segmentMdatData,
                        segmentIndex,
                        timescale
                    );
                    
                    if (segmentData) {
                        segments.push({
                            data: segmentData,
                            index: segmentIndex,
                            duration: segmentDuration,
                            filename: `segment_${String(segmentIndex).padStart(4, '0')}.m4s`,
                            isInitSegment: false
                        });
                        console.log(`Created media segment ${segmentIndex}: ${segmentData.byteLength} bytes (${currentSegmentSamples.length} samples, ${segmentMdatData.length} bytes mdat data)`);
                    }
                    
                    segmentIndex++;
                    currentSegmentSamples = [];
                    currentSegmentStartTime = Math.floor(time / segmentDurationInTimescale) * segmentDurationInTimescale;
                    currentSegmentStartByte = -1;
                    currentSegmentEndByte = -1;
                }
                
                if (currentSegmentSamples.length === 0) {
                    currentSegmentStartByte = bytePos;
                }
                currentSegmentEndByte = Math.max(currentSegmentEndByte, sampleEndByte);
                currentSegmentSamples.push(sample);
            }
            
            // Handle remaining samples
            if (currentSegmentSamples.length > 0) {
                const firstSampleByte = currentSegmentStartByte >= 0 ? currentSegmentStartByte : samplesWithBytePos[samplesWithBytePos.length - currentSegmentSamples.length].bytePos;
                const lastSampleEnd = currentSegmentEndByte >= 0 ? currentSegmentEndByte : completeMdatData.length;
                
                // For last segment, include all remaining data to end of mdat box
                const segmentMdatData = completeMdatData.slice(
                    Math.max(0, firstSampleByte),
                    completeMdatData.length // Always go to end for last segment
                );
                
                const segmentData = createMediaSegmentFromMdatData(
                    currentSegmentSamples,
                    segmentMdatData,
                    segmentIndex,
                    timescale
                );
                
                if (segmentData) {
                    const lastSegmentDuration = (currentSegmentSamples[currentSegmentSamples.length - 1].cts - currentSegmentSamples[0].cts) / timescale;
                    segments.push({
                        data: segmentData,
                        index: segmentIndex,
                        duration: lastSegmentDuration,
                        filename: `segment_${String(segmentIndex).padStart(4, '0')}.m4s`,
                        isInitSegment: false
                    });
                    console.log(`Created final media segment ${segmentIndex}: ${segmentData.byteLength} bytes (${segmentMdatData.length} bytes mdat data)`);
                }
            }
            
            // Verify we've captured all mdat data
            const totalSegmentMdatSize = segments
                .filter(s => !s.isInitSegment)
                .reduce((sum, seg) => {
                    // Extract mdat size from segment (approximate - moof + mdat)
                    // For accurate measurement, we'd need to parse each segment
                    return sum + seg.data.byteLength;
                }, 0);
            
            console.log(`Total segments created: ${segments.length} (1 init + ${segments.length - 1} media segments)`);
            console.log(`Total segment data size: ${totalSegmentMdatSize} bytes`);
            console.log(`Complete mdat box data size: ${completeMdatData.length} bytes`);
            
            if (totalSegmentMdatSize < completeMdatData.length * 0.9) {
                console.warn(`WARNING: Segment data (${totalSegmentMdatSize} bytes) is significantly less than mdat box (${completeMdatData.length} bytes)`);
            }
            
            resolve(segments);
        }
        
        /**
         * Creates a media segment (moof + mdat) from samples and mdat data
         * @param samples - Samples in this segment (for moof box)
         * @param mdatData - Complete mdat box data for this segment (includes gaps)
         * @param segmentIndex - Segment index
         * @param timescale - Video track timescale
         */
        function createMediaSegmentFromMdatData(
            samples: any[],
            mdatData: Uint8Array,
            segmentIndex: number,
            timescale: number
        ): ArrayBuffer | null {
            if (samples.length === 0 || mdatData.length === 0) {
                return null;
            }
            
            // Create moof box first (needed to calculate data_offset)
            const moofBox = createMoofBox(samples, segmentIndex, timescale);
            
            // Create mdat box with the complete data (including gaps)
            const mdatSize = 8 + mdatData.length;
            const mdatBox = new Uint8Array(mdatSize);
            const mdatView = new DataView(mdatBox.buffer);
            mdatView.setUint32(0, mdatSize, false); // big-endian
            mdatBox[4] = 'm'.charCodeAt(0);
            mdatBox[5] = 'd'.charCodeAt(0);
            mdatBox[6] = 'a'.charCodeAt(0);
            mdatBox[7] = 't'.charCodeAt(0);
            mdatBox.set(mdatData, 8);
            
            // Update data_offset in trun box (offset from start of moof to start of mdat data)
            const moofView = new DataView(moofBox.buffer);
            let moofOffset = 8; // Skip moof header
            // Skip mfhd
            const mfhdSize = moofView.getUint32(moofOffset, false);
            moofOffset += mfhdSize;
            // Skip traf header
            moofOffset += 8;
            // Skip tfhd
            const tfhdSize = moofView.getUint32(moofOffset, false);
            moofOffset += tfhdSize;
            // Now at trun box
            moofOffset += 8; // Skip trun header
            moofOffset += 4; // Skip sample_count
            // Update data_offset: distance from start of moof to start of mdat data
            const dataOffset = moofBox.length + 8; // moof size + mdat header (8 bytes)
            moofView.setUint32(moofOffset, dataOffset, false);
            
            // Combine moof + mdat (moof comes first in fMP4)
            const segmentSize = moofBox.length + mdatBox.length;
            const segment = new Uint8Array(segmentSize);
            segment.set(moofBox, 0);
            segment.set(mdatBox, moofBox.length);
            
            return segment.buffer;
        }
        
        /**
         * Creates a moof (Movie Fragment) box with proper structure
         * moof contains:
         *   - mfhd (Movie Fragment Header) - sequence number
         *   - traf (Track Fragment) containing:
         *     - tfhd (Track Fragment Header) - track info
         *     - trun (Track Run) - sample data offsets and sizes
         */
        function createMoofBox(samples: any[], segmentIndex: number, timescale: number): Uint8Array {
            if (!fileInfo || samples.length === 0) {
                return new Uint8Array(0);
            }
            
            const videoTrack = fileInfo.tracks.find((track: any) => track.type === 'video');
            if (!videoTrack) {
                return new Uint8Array(0);
            }
            
            // Calculate sizes
            // mfhd: 8 (header) + 4 (sequence number) = 12 bytes
            const mfhdSize = 12;
            
            // tfhd: 8 (header) + 4 (track_id) + optional fields = 12+ bytes
            // Using minimal tfhd (12 bytes)
            const tfhdSize = 12;
            
            // trun: 8 (header) + 4 (sample_count) + 4 (data_offset) + per-sample entries
            // Each sample entry: 4 (sample_duration) + 4 (sample_size) = 8 bytes
            const trunHeaderSize = 16; // header + sample_count + data_offset
            const trunSampleEntrySize = 8; // duration + size per sample
            const trunSize = trunHeaderSize + (samples.length * trunSampleEntrySize);
            
            // traf: 8 (header) + tfhd + trun
            const trafSize = 8 + tfhdSize + trunSize;
            
            // moof: 8 (header) + mfhd + traf
            const moofSize = 8 + mfhdSize + trafSize;
            
            const moofBox = new Uint8Array(moofSize);
            const view = new DataView(moofBox.buffer);
            let offset = 0;
            
            // moof box header
            view.setUint32(offset, moofSize, false);
            moofBox[offset + 4] = 'm'.charCodeAt(0);
            moofBox[offset + 5] = 'o'.charCodeAt(0);
            moofBox[offset + 6] = 'o'.charCodeAt(0);
            moofBox[offset + 7] = 'f'.charCodeAt(0);
            offset += 8;
            
            // mfhd box (Movie Fragment Header)
            view.setUint32(offset, mfhdSize, false);
            moofBox[offset + 4] = 'm'.charCodeAt(0);
            moofBox[offset + 5] = 'f'.charCodeAt(0);
            moofBox[offset + 6] = 'h'.charCodeAt(0);
            moofBox[offset + 7] = 'd'.charCodeAt(0);
            offset += 8;
            view.setUint32(offset, segmentIndex, false); // sequence_number
            offset += 4;
            
            // traf box (Track Fragment)
            view.setUint32(offset, trafSize, false);
            moofBox[offset + 4] = 't'.charCodeAt(0);
            moofBox[offset + 5] = 'r'.charCodeAt(0);
            moofBox[offset + 6] = 'a'.charCodeAt(0);
            moofBox[offset + 7] = 'f'.charCodeAt(0);
            offset += 8;
            
            // tfhd box (Track Fragment Header)
            view.setUint32(offset, tfhdSize, false);
            moofBox[offset + 4] = 't'.charCodeAt(0);
            moofBox[offset + 5] = 'f'.charCodeAt(0);
            moofBox[offset + 6] = 'h'.charCodeAt(0);
            moofBox[offset + 7] = 'd'.charCodeAt(0);
            offset += 8;
            view.setUint32(offset, videoTrack.id, false); // track_ID
            offset += 4;
            
            // trun box (Track Run)
            view.setUint32(offset, trunSize, false);
            moofBox[offset + 4] = 't'.charCodeAt(0);
            moofBox[offset + 5] = 'r'.charCodeAt(0);
            moofBox[offset + 6] = 'u'.charCodeAt(0);
            moofBox[offset + 7] = 'n'.charCodeAt(0);
            offset += 8;
            view.setUint32(offset, samples.length, false); // sample_count
            offset += 4;
            // data_offset will be set after mdat is created (relative to moof start)
            // For now, set to 0 (will be updated)
            view.setUint32(offset, 0, false); // data_offset (placeholder)
            offset += 4;
            
            // Sample entries: duration and size for each sample
            for (const sample of samples) {
                const duration = sample.duration || 1;
                const size = sample.size || 0;
                view.setUint32(offset, duration, false); // sample_duration
                offset += 4;
                view.setUint32(offset, size, false); // sample_size
                offset += 4;
            }
            
            return moofBox;
        }
        
        // Load the file
        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            if (e.target?.result) {
                fileBuffer = e.target.result as ArrayBuffer;
                // MP4Box requires fileStart property on the buffer
                const bufferWithStart = fileBuffer as any;
                bufferWithStart.fileStart = 0;
                mp4boxFile.appendBuffer(bufferWithStart);
                mp4boxFile.flush();
            }
        };
        
        fileReader.onerror = () => {
            reject(new Error('Failed to read video file'));
        };
        
        fileReader.readAsArrayBuffer(videoFile);
    });
}
