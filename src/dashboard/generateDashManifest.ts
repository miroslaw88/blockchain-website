// Generate MPEG-DASH manifest for video files

/**
 * Generates a basic MPEG-DASH manifest (MPD) for a video file.
 * This creates a simple manifest that can be used for adaptive streaming.
 * 
 * Note: For full MPEG-DASH support with multiple bitrates and segments,
 * you would need to transcode the video first (e.g., using FFmpeg.wasm).
 * This implementation creates a basic manifest for the original video file.
 * 
 * @param videoFile - The video file to generate a manifest for
 * @returns Promise that resolves to the MPD manifest XML string
 */
export async function generateDashManifest(videoFile: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(videoFile);
        
        const cleanup = () => {
            URL.revokeObjectURL(video.src);
            video.remove();
        };
        
        video.addEventListener('loadedmetadata', () => {
            try {
                const duration = video.duration;
                const width = video.videoWidth;
                const height = video.videoHeight;
                
                // Get video codec information if available
                const codecs = getVideoCodec(videoFile.type);
                
                // Format duration as ISO 8601 duration (PT#S format)
                const isoDuration = formatISODuration(duration);
                
                // Generate MPD manifest
                const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" 
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd"
     type="static" 
     mediaPresentationDuration="${isoDuration}" 
     minBufferTime="PT1.5S" 
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period id="0" start="PT0S" duration="${isoDuration}">
    <AdaptationSet id="0" contentType="video" segmentAlignment="true" bitstreamSwitching="true">
      <Representation id="0" 
                      mimeType="${videoFile.type}" 
                      width="${width}" 
                      height="${height}" 
                      bandwidth="0"
                      ${codecs ? `codecs="${codecs}"` : ''}>
        <BaseURL>${videoFile.name}</BaseURL>
        <SegmentBase indexRangeExact="true">
          <Initialization range="0-0"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
                
                cleanup();
                resolve(mpd);
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
        
        video.addEventListener('error', (e) => {
            cleanup();
            reject(new Error(`Failed to load video metadata: ${video.error?.message || 'Unknown error'}`));
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            cleanup();
            reject(new Error('Timeout while loading video metadata'));
        }, 10000);
    });
}

/**
 * Formats duration in seconds to ISO 8601 duration format (PT#S)
 */
function formatISODuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    
    let duration = 'PT';
    if (hours > 0) {
        duration += `${hours}H`;
    }
    if (minutes > 0) {
        duration += `${minutes}M`;
    }
    if (secs > 0 || milliseconds > 0) {
        if (milliseconds > 0) {
            duration += `${secs}.${milliseconds.toString().padStart(3, '0')}S`;
        } else {
            duration += `${secs}S`;
        }
    } else if (hours === 0 && minutes === 0) {
        duration += '0S';
    }
    
    return duration;
}

/**
 * Gets video codec string based on MIME type
 */
function getVideoCodec(mimeType: string): string | null {
    // Common codec mappings
    const codecMap: Record<string, string> = {
        'video/mp4': 'avc1.42e01e,mp4a.40.2', // H.264 + AAC
        'video/webm': 'vp8,vorbis', // VP8 + Vorbis
        'video/webm; codecs="vp9"': 'vp9,opus', // VP9 + Opus
        'video/webm; codecs="vp8"': 'vp8,vorbis', // VP8 + Vorbis
    };
    
    return codecMap[mimeType] || null;
}

