// Download file from storage provider and decrypt

import { getKeplr, CHAIN_ID } from './utils';
import { decryptFile, decryptFileKeyWithECIES, IAesBundle } from './osd-blockchain-sdk';

// Track download progress toasts by merkle_root
const downloadProgressToasts: Map<string, { toastId: string; $progressBar: JQuery<HTMLElement>; $status: JQuery<HTMLElement> }> = new Map();

/**
 * Show download progress toast (similar to upload progress)
 * @param merkleRoot - Merkle root of the file
 * @param fileName - Name of the file being downloaded
 */
export function showDownloadProgressToast(merkleRoot: string, fileName: string): void {
    // Check if toast already exists for this merkle root
    if (downloadProgressToasts.has(merkleRoot)) {
        return; // Toast already exists
    }
    
    const $container = $('#toastContainer');
    if ($container.length === 0) {
        // Create container if it doesn't exist
        $('body').append('<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 9999;"></div>');
    }
    
    const toastId = `download-toast-${merkleRoot}`;
    const progressId = `download-progress-${merkleRoot}`;
    const statusId = `download-status-${merkleRoot}`;
    
    const $toast = $(`
        <div class="toast bg-info text-white" role="alert" aria-live="polite" aria-atomic="true" id="${toastId}" data-bs-autohide="false">
            <div class="toast-header bg-info text-white border-0">
                <strong class="me-auto">📥 Downloading</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                <div class="mb-2">
                    <strong>${fileName}</strong>
                </div>
                <div class="progress mb-2" style="height: 20px;">
                    <div id="${progressId}" class="progress-bar progress-bar-striped progress-bar-animated bg-success text-white" 
                         role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                        0%
                    </div>
                </div>
                <small class="d-block" id="${statusId}">Initializing download...</small>
            </div>
        </div>
    `);
    
    $('#toastContainer').append($toast);
    
    // Initialize and show toast using Bootstrap (don't auto-hide)
    const toastElement = $toast[0];
    const toast = new (window as any).bootstrap.Toast(toastElement, {
        autohide: false // Don't auto-hide - we'll hide it manually when download completes
    });
    toast.show();
    
    const $progressBar = $(`#${progressId}`);
    const $status = $(`#${statusId}`);
    
    // Store in map
    downloadProgressToasts.set(merkleRoot, { toastId, $progressBar, $status });
}

/**
 * Update download progress in toast
 * @param merkleRoot - Merkle root of the file
 * @param progress - Progress percentage (0-100)
 * @param status - Status message
 */
export function updateDownloadProgress(merkleRoot: string, progress: number, status: string): void {
    const toastData = downloadProgressToasts.get(merkleRoot);
    if (!toastData) return;
    
    if (toastData.$progressBar && toastData.$progressBar.length > 0) {
        toastData.$progressBar.css('width', `${progress}%`).attr('aria-valuenow', progress);
        toastData.$progressBar.text(`${Math.round(progress)}%`);
    }
    
    if (toastData.$status && toastData.$status.length > 0) {
        toastData.$status.text(status);
    }
}

/**
 * Update download status message only
 * @param merkleRoot - Merkle root of the file
 * @param message - Status message to display
 */
export function updateDownloadStatus(merkleRoot: string, message: string): void {
    const toastData = downloadProgressToasts.get(merkleRoot);
    if (toastData && toastData.$status && toastData.$status.length > 0) {
        toastData.$status.text(message);
    }
}

/**
 * Remove download progress toast
 * @param merkleRoot - Merkle root of the file
 * @param success - Whether the download was successful
 */
export function finalizeDownloadProgress(merkleRoot: string, success: boolean): void {
    const toastData = downloadProgressToasts.get(merkleRoot);
    if (!toastData) return;
    
    const $toast = $(`#${toastData.toastId}`);
    
    if ($toast.length > 0) {
        const toastElement = $toast[0];
        const toastInstance = (window as any).bootstrap.Toast.getInstance(toastElement);
        
        if (toastInstance) {
            // Hide the toast
            toastInstance.hide();
            
            // Remove toast element after it's hidden
            $toast.on('hidden.bs.toast', () => {
                $toast.remove();
            });
        } else {
            // If toast instance doesn't exist, just remove the element
            $toast.remove();
        }
    }
    
    // Remove from map
    downloadProgressToasts.delete(merkleRoot);
}

/**
 * Get download progress toast data (internal use)
 * @param merkleRoot - Merkle root of the file
 * @returns Toast data or null if not found
 */
function getDownloadProgressToast(merkleRoot: string): { toastId: string; $progressBar: JQuery<HTMLElement>; $status: JQuery<HTMLElement> } | null {
    return downloadProgressToasts.get(merkleRoot) || null;
}

// Show toast notification
function showToast(message: string, type: 'error' | 'success' | 'info' = 'error'): void {
    const $container = $('#toastContainer');
    if ($container.length === 0) {
        // Create container if it doesn't exist
        $('body').append('<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toastContainer" style="z-index: 9999;"></div>');
    }
    
    const toastId = `toast-${Date.now()}`;
    const bgClass = type === 'error' ? 'bg-danger' : type === 'success' ? 'bg-success' : 'bg-info';
    const icon = type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️';
    
    const $toast = $(`
        <div class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" id="${toastId}">
            <div class="toast-header ${bgClass} text-white border-0">
                <strong class="me-auto">${icon} ${type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info'}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `);
    
    $('#toastContainer').append($toast);
    
    // Initialize and show toast using Bootstrap
    const toastElement = $toast[0];
    const toast = new (window as any).bootstrap.Toast(toastElement, {
        autohide: true,
        delay: type === 'error' ? 5000 : 3000
    });
    toast.show();
    
    // Remove toast element after it's hidden
    $toast.on('hidden.bs.toast', () => {
        $toast.remove();
    });
}

// Fetch with timeout helper
async function fetchWithTimeout(url: string, timeout: number = 10000, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const fetchOptions: RequestInit = {
            ...options,
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };
        
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeout}ms. The server may be unreachable or taking too long to respond.`);
        }
        throw error; 
    }
}

// Helper function to concatenate multiple Uint8Arrays
function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

// Helper function to find byte sequence in array
function findBytes(data: Uint8Array, pattern: Uint8Array, startOffset: number = 0): number {
    for (let i = startOffset; i <= data.length - pattern.length; i++) {
        let match = true;
        for (let j = 0; j < pattern.length; j++) {
            if (data[i + j] !== pattern[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            return i;
        }
    }
    return -1;
}

// Helper function to parse HTTP headers from text
function parseHeaders(headerText: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const lines = headerText.split('\r\n');
    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            headers[key] = value;
        }
    }
    return headers;
}

// Helper function to construct download URL from provider address
function constructDownloadUrl(providerAddress: string, merkleRoot: string): string {
    // Remove port from provider address as Caddy handles routing
    if (providerAddress.includes('storage.datavault.space')) {
        // Use Caddy proxy
        return `https://storage.datavault.space/api/storage/files/download?merkle_root=${merkleRoot}`;
    } else {
        // Extract hostname (remove port if present)
        let baseUrl: string;
        if (providerAddress.startsWith('http://') || providerAddress.startsWith('https://')) {
            const url = new URL(providerAddress);
            url.port = ''; // Remove port
            // Use HTTPS protocol (Caddy handles TLS)
            baseUrl = `https://${url.hostname}`;
        } else {
            // Remove port from address
            const hostname = providerAddress.split(':')[0];
            baseUrl = `https://${hostname}`;
        }
        
        return `${baseUrl}/api/storage/files/download?merkle_root=${merkleRoot}`;
    }
}

// Helper function to download encrypted file from a single provider
async function downloadFromProvider(
    providerAddress: string,
    merkleRoot: string,
    fileName: string,
    $button?: JQuery<HTMLElement>
): Promise<{ encryptedBlob: Blob; responseFileName: string; responseContentType: string }> {
    const downloadUrl = constructDownloadUrl(providerAddress, merkleRoot);
    
    const encryptedResponse = await fetchWithTimeout(downloadUrl, 60000, {
        method: 'GET'
    }); // 60 second timeout for file download
    
    if (!encryptedResponse.ok) {
        throw new Error(`Failed to download file: ${encryptedResponse.status} ${encryptedResponse.statusText}`);
    }
    
    // Extract metadata from response headers
    const responseFileName = encryptedResponse.headers.get('X-Original-Name') || fileName;
    const responseContentType = encryptedResponse.headers.get('X-Content-Type') || '';
    const totalChunksHeader = encryptedResponse.headers.get('X-Total-Chunks');
    const contentType = encryptedResponse.headers.get('Content-Type') || '';
    
    // Check if response is multipart
    if (contentType.includes('multipart/byteranges')) {
        // Parse multipart response with progress updates
        
        // Get total chunks from main response header
        const totalChunksNum = totalChunksHeader ? parseInt(totalChunksHeader, 10) : null;
        
        // Get toast that was created when download button was clicked
        const toastData = getDownloadProgressToast(merkleRoot);
        
        // Update status to show downloading
        if (toastData) {
            updateDownloadStatus(merkleRoot, 'Downloading chunks...');
        }
        
        // Progress callback
        const progressCallback = (chunkIndex: number, total: number) => {
            const progress = ((chunkIndex + 1) / total) * 100;
            updateDownloadProgress(merkleRoot, progress, `Downloading chunk ${chunkIndex + 1} of ${total}...`);
        };
        
        const encryptedBlob = await parseMultipartResponse(encryptedResponse, contentType, totalChunksNum, progressCallback);
        
        return { encryptedBlob, responseFileName, responseContentType };
    } else {
        throw new Error('Expected multipart/byteranges response but received different content type. The storage provider must return files in multipart format.');
    }
}

// Parse multipart response and combine chunks in order (streaming)
// progressCallback: (chunkIndex: number, totalChunks: number) => void
async function parseMultipartResponse(
    response: Response, 
    contentType: string,
    totalChunksFromHeader: number | null,
    progressCallback?: (chunkIndex: number, totalChunks: number) => void
): Promise<Blob> {
    // Extract boundary from Content-Type header
    // Format: multipart/byteranges; boundary=----WebKitFormBoundary...
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
        throw new Error('No boundary found in multipart Content-Type header');
    }
    const boundary = boundaryMatch[1].trim();
    const boundaryBytes = new TextEncoder().encode(`--${boundary}`);
    const endBoundaryBytes = new TextEncoder().encode(`--${boundary}--`);
    
    // Stream the response to parse chunks as they arrive
    if (!response.body) {
        throw new Error('Response body is not available for streaming');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Array<{ index: number; data: Uint8Array }> = [];
    
    let buffer = new Uint8Array(0);
    let currentPartHeaders: Record<string, string> | null = null;
    let currentChunkIndex: number | null = null;
    let currentChunkData: Uint8Array[] = [];
    let expectedContentLength: number | null = null;
    // Use totalChunks from main response header, fallback to Content-Range if not available
    let totalChunks: number | null = totalChunksFromHeader;
    let inHeaders = true;
    let headerBuffer = '';
    let firstBoundarySkipped = false;
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                // Process any remaining data
                if (currentChunkData.length > 0 && currentChunkIndex !== null) {
                    const chunkData = concatenateUint8Arrays(currentChunkData);
                    chunks.push({ index: currentChunkIndex, data: chunkData });
                    
                    if (progressCallback && totalChunks !== null) {
                        progressCallback(currentChunkIndex, totalChunks);
                    }
                }
                break;
            }
            
            // Append new data to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;
            
            // Skip first boundary if not already skipped
            if (!firstBoundarySkipped) {
                const firstBoundaryPos = findBytes(buffer, boundaryBytes);
                if (firstBoundaryPos !== -1) {
                    // Skip boundary and CRLF after it
                    buffer = buffer.slice(firstBoundaryPos + boundaryBytes.length);
                    // Skip CRLF
                    if (buffer.length >= 2 && buffer[0] === 0x0D && buffer[1] === 0x0A) {
                        buffer = buffer.slice(2);
                    } else if (buffer.length >= 1 && buffer[0] === 0x0A) {
                        buffer = buffer.slice(1);
                    }
                    firstBoundarySkipped = true;
                } else {
                    // First boundary not found yet, wait for more data
                    continue;
                }
            }
            
            // Process buffer
            while (buffer.length > 0) {
                if (inHeaders) {
                    // Look for header end marker (\r\n\r\n)
                    const headerEndMarker = new TextEncoder().encode('\r\n\r\n');
                    const headerEndPos = findBytes(buffer, headerEndMarker);
                    
                    if (headerEndPos === -1) {
                        // Headers not complete yet, wait for more data
                        break;
                    }
                    
                    // Parse headers
                    headerBuffer += decoder.decode(buffer.slice(0, headerEndPos));
                    currentPartHeaders = parseHeaders(headerBuffer);
                    
                    // Extract chunk index and total chunks
                    const chunkIndexHeader = currentPartHeaders['X-Chunk-Index'] || currentPartHeaders['x-chunk-index'];
                    const contentRangeHeader = currentPartHeaders['Content-Range'] || currentPartHeaders['content-range'];
                    
                    // Get chunk index from X-Chunk-Index or Content-Range
                    if (chunkIndexHeader) {
                        currentChunkIndex = parseInt(chunkIndexHeader, 10);
                    } else if (contentRangeHeader) {
                        const rangeMatch = contentRangeHeader.match(/chunk\s+(\d+)\/(\d+)/i);
                        if (rangeMatch) {
                            currentChunkIndex = parseInt(rangeMatch[1], 10);
                        }
                    }
                    
                    // Always try to extract total chunks from Content-Range if not already set
                    if (totalChunks === null && contentRangeHeader) {
                        const rangeMatch = contentRangeHeader.match(/chunk\s+\d+\/(\d+)/i);
                        if (rangeMatch) {
                            totalChunks = parseInt(rangeMatch[1], 10);
                        }
                    }
                    
                    if (currentChunkIndex === null) {
                        throw new Error('Could not determine chunk index from headers');
                    }
                    
                    // Get content length
                    const contentLengthHeader = currentPartHeaders['Content-Length'] || currentPartHeaders['content-length'];
                    expectedContentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
                    
                    // Move past headers
                    buffer = buffer.slice(headerEndPos + 4);
                    inHeaders = false;
                    currentChunkData = [];
                    headerBuffer = '';
                } else {
                    // Reading chunk data - look for next boundary
                    const nextBoundaryPos = findBytes(buffer, boundaryBytes);
                    const endBoundaryPos = findBytes(buffer, endBoundaryBytes);
                    
                    if (nextBoundaryPos !== -1) {
                        // Found next boundary - extract chunk data (excluding CRLF before boundary)
                        const chunkEnd = nextBoundaryPos - 2; // Account for \r\n before boundary
                        if (chunkEnd > 0) {
                            currentChunkData.push(buffer.slice(0, chunkEnd));
                        }
                        
                        // Complete current chunk
                        if (currentChunkIndex !== null && currentChunkData.length > 0) {
                            const chunkData = concatenateUint8Arrays(currentChunkData);
                            chunks.push({ index: currentChunkIndex, data: chunkData });
                            
                            // Call progress callback
                            if (progressCallback && totalChunks !== null) {
                                progressCallback(currentChunkIndex, totalChunks);
                            }
                        }
                        
                        // Move to next part
                        buffer = buffer.slice(nextBoundaryPos + boundaryBytes.length);
                        inHeaders = true;
                        currentChunkIndex = null;
                        currentChunkData = [];
                        expectedContentLength = null;
                    } else if (endBoundaryPos !== -1) {
                        // Found end boundary - last chunk
                        const chunkEnd = endBoundaryPos - 2; // Account for \r\n before boundary
                        if (chunkEnd > 0) {
                            currentChunkData.push(buffer.slice(0, chunkEnd));
                        }
                        
                        // Complete last chunk
                        if (currentChunkIndex !== null && currentChunkData.length > 0) {
                            const chunkData = concatenateUint8Arrays(currentChunkData);
                            chunks.push({ index: currentChunkIndex, data: chunkData });
                            
                            // Call progress callback
                            if (progressCallback && totalChunks !== null) {
                                progressCallback(currentChunkIndex, totalChunks);
                            }
                        }
                        
                        // Done
                        buffer = new Uint8Array(0);
                        break;
                    } else {
                        // No boundary found yet - accumulate data for current chunk
                        // Keep enough data in buffer to detect boundary (need at least boundary length)
                        const minBufferSize = boundaryBytes.length + 4; // boundary + CRLF
                        
                        if (buffer.length < minBufferSize) {
                            // Not enough data to detect boundary, wait for more
                            break;
                        }
                        
                        // Check if we can safely extract data (leaving enough for boundary detection)
                        const extractSize = buffer.length - minBufferSize;
                        if (extractSize > 0) {
                            currentChunkData.push(buffer.slice(0, extractSize));
                            buffer = buffer.slice(extractSize);
                        } else {
                            // Not enough to extract, wait for more data
                            break;
                        }
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    
    // Sort chunks by index
    chunks.sort((a, b) => a.index - b.index);
    
    // Combine chunks in order
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const combined = new Uint8Array(totalSize);
    let combinedOffset = 0;
    for (const chunk of chunks) {
        combined.set(chunk.data, combinedOffset);
        combinedOffset += chunk.data.length;
    }
    
    return new Blob([combined]);
}

// Helper function to complete the download (decrypt and save)
async function finishDownload(encryptedBlob: Blob, fileAesBundle: IAesBundle, fileName: string): Promise<void> {
    // Step 3: Decrypt file using AES bundle
    const { decryptFile } = await import('./osd-blockchain-sdk');
    const decryptedBlob = await decryptFile(encryptedBlob, fileAesBundle);
    
    // Step 4: Save file
    const url = URL.createObjectURL(decryptedBlob);
    const $a = $('<a>').attr({ href: url, download: fileName });
    $('body').append($a);
    $a[0].click();
    $a.remove();
    URL.revokeObjectURL(url);
}

// Download shared file directly from storage provider
// For shared files, the encrypted file key should be included in the shared file response
export async function downloadSharedFile(
    merkleRoot: string,
    storageProviders: Array<{ provider_id?: string; provider_address?: string }>,
    metadata: any,
    encryptedFileKeyBase64: string,
    walletAddress: string,
    $button?: JQuery<HTMLElement>
): Promise<void> {
    try {
        // Toast should already be created by the button click handler
        if (!merkleRoot) {
            throw new Error('Merkle root not found');
        }
        
        if (!encryptedFileKeyBase64) {
            throw new Error('Encrypted file key not found');
        }
        
        if (storageProviders.length === 0) {
            throw new Error('No storage providers available for this file');
        }
        
        // Update status to show decrypting key
        updateDownloadStatus(merkleRoot, 'Decrypting file key...');
        
        // Decrypt file's AES bundle with recipient's private key
        const { decryptFileKeyWithECIES } = await import('./osd-blockchain-sdk');
        const fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKeyBase64, walletAddress);
        
        // Get filename from metadata
        const fileName = metadata.original_name || 'file';
        
        // Try downloading from each provider until one succeeds
        let downloadSucceeded = false;
        let lastError: Error | null = null;
        
        for (let providerIndex = 0; providerIndex < storageProviders.length; providerIndex++) {
            const provider = storageProviders[providerIndex];
            const providerAddress = provider.provider_address;
            
            if (!providerAddress) {
                console.warn(`Provider ${providerIndex} has no address, skipping...`);
                continue;
            }
            
            // Show provider switch message if not the first provider
            if (providerIndex > 0) {
                updateDownloadStatus(merkleRoot, `Switching to provider ${providerIndex + 1}/${storageProviders.length}...`);
            } else {
                updateDownloadStatus(merkleRoot, `Downloading from provider ${providerIndex + 1}/${storageProviders.length}...`);
            }
            
            try {
                const result = await downloadFromProvider(providerAddress, merkleRoot, fileName, $button);
            
                // Update status to show decrypting
                updateDownloadStatus(merkleRoot, 'Decrypting file...');
            
                // Download succeeded, finish the download process
                await finishDownload(result.encryptedBlob, fileAesBundle, result.responseFileName);
                
                // Update status to show success
                updateDownloadStatus(merkleRoot, 'Download complete!');
                
                downloadSucceeded = true;
                break; // Exit provider loop
                
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`Download failed for provider ${providerIndex} (${providerAddress}):`, lastError);
                
                if (providerIndex < storageProviders.length - 1) {
                    // Continue to next provider - status will be updated at start of next iteration
                } else {
                    updateDownloadStatus(merkleRoot, 'Download failed. All providers exhausted.');
                    console.error('All providers exhausted. Download failed.');
                    // Will throw error after loop
                }
            }
        }
        
        // If download failed for all providers, throw error
        if (!downloadSucceeded) {
            throw new Error(
                `Failed to download from all ${storageProviders.length} available provider(s). ` +
                `Last error: ${lastError?.message || 'Unknown error'}`
            );
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        updateDownloadStatus(merkleRoot, `Error: ${errorMessage}`);
        showToast(`Download failed: ${errorMessage}`, 'error');
        throw error;
    }
}

// Download file from storage provider
export async function downloadFile(fileMetadata: any, walletAddress: string, $button?: JQuery<HTMLElement>): Promise<void> {
    try {
        const merkleRoot = fileMetadata.merkle_root || '';
        if (!merkleRoot) {
            throw new Error('Merkle root not found in file metadata');
        }
        
        // Toast should already be created by the button click handler
        // Step 1: Query file information from indexer to get encrypted_file_key and storage providers
        const { Dashboard } = await import('./dashboard/index');
        const indexer = await Dashboard.waitForIndexer();
        
        const protocol = indexer.indexer_address.includes('localhost') || indexer.indexer_address.match(/^\d+\.\d+\.\d+\.\d+/) ? 'http' : 'https';
        const baseUrl = indexer.indexer_address.startsWith('http://') || indexer.indexer_address.startsWith('https://')
            ? indexer.indexer_address
            : `${protocol}://${indexer.indexer_address}`;
        const downloadInfoUrl = `${baseUrl}/api/indexer/v1/files/query`;
        
        
        const infoResponse = await fetchWithTimeout(downloadInfoUrl, 15000, {
            method: 'POST',
            body: JSON.stringify({
                merkle_root: merkleRoot,
                owner: walletAddress,
                requester: walletAddress
            })
        });
        if (!infoResponse.ok) {
            throw new Error(`Failed to query file info from indexer: ${infoResponse.status} ${infoResponse.statusText}`);
        }
        
        const downloadInfo = await infoResponse.json();
        
        // Get encrypted_file_key from indexer response
        const fileData = downloadInfo.file || {};
        const encryptedFileKey = fileData.encrypted_file_key;
        if (!encryptedFileKey) {
            throw new Error('Encrypted file key not found in indexer response. File may not be properly encrypted.');
        }
        
        // Decrypt file's AES bundle with owner's private key
        const { decryptFileKeyWithECIES } = await import('./osd-blockchain-sdk');
        let fileAesBundle;
        try {
            fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKey, walletAddress);
        } catch (error) {
            console.error('Error decrypting file key:', error);
            throw error;
        }
        
        // Parse metadata (handle both camelCase and snake_case)
        const metadataStr = fileData.metadata || '';
        const metadata: any = JSON.parse(metadataStr || '{}');
        
        // Get filename from original_name (hashed format stores original in original_name)
        const fileName = metadata.original_name || 'file';
        
        // Step 2: Download complete encrypted file from storage provider
        // Server returns multipart response with chunks
        const storageProviders = downloadInfo.storage_providers || [];
        if (storageProviders.length === 0) {
            throw new Error('No storage providers available for this file');
        }
        
        // Update status to show starting download
        updateDownloadStatus(merkleRoot, 'Connecting to storage provider...');
        
        // Try downloading from each provider until one succeeds
        let downloadSucceeded = false;
        let lastError: Error | null = null;
        
        for (let providerIndex = 0; providerIndex < storageProviders.length; providerIndex++) {
            const provider = storageProviders[providerIndex];
        const providerAddress = provider.provider_address;
        
        if (!providerAddress) {
                console.warn(`Provider ${providerIndex} has no address, skipping...`);
                continue;
        }
        
            // Show provider switch message if not the first provider
            if (providerIndex > 0) {
                updateDownloadStatus(merkleRoot, `Switching to provider ${providerIndex + 1}/${storageProviders.length}...`);
            } else {
                updateDownloadStatus(merkleRoot, `Downloading from provider ${providerIndex + 1}/${storageProviders.length}...`);
            }
        
            try {
                const result = await downloadFromProvider(providerAddress, merkleRoot, fileName, $button);
                
                // Update status to show decrypting
                updateDownloadStatus(merkleRoot, 'Decrypting file...');
                
                // Download succeeded, finish the download process
                await finishDownload(result.encryptedBlob, fileAesBundle, result.responseFileName);
                
                // Update status to show success
                updateDownloadStatus(merkleRoot, 'Download complete!');
                
                downloadSucceeded = true;
                break; // Exit provider loop
                
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`Download failed for provider ${providerIndex} (${providerAddress}):`, lastError);
                
                if (providerIndex < storageProviders.length - 1) {
                    // Continue to next provider - status will be updated at start of next iteration
                } else {
                    updateDownloadStatus(merkleRoot, 'Download failed. All providers exhausted.');
                    console.error('All providers exhausted. Download failed.');
                    // Will throw error after loop
                }
            }
            }
            
        // If download failed for all providers, throw error
        if (!downloadSucceeded) {
            throw new Error(
                `Failed to download from all ${storageProviders.length} available provider(s). ` +
                `Last error: ${lastError?.message || 'Unknown error'}`
            );
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        showToast(`Download failed: ${errorMessage}`, 'error');
        throw error;
    }
}

