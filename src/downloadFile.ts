// Download file from storage provider and decrypt

import { getKeplr, CHAIN_ID } from './utils';
import { decryptFile, decryptFileKeyWithECIES, IAesBundle } from './osd-blockchain-sdk';

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
    
    console.log('Multipart boundary:', boundary);
    
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
    
    console.log('parseMultipartResponse: totalChunks from header =', totalChunks);
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                // Process any remaining data
                if (currentChunkData.length > 0 && currentChunkIndex !== null) {
                    const chunkData = concatenateUint8Arrays(currentChunkData);
                    chunks.push({ index: currentChunkIndex, data: chunkData });
                    console.log(`✓ Parsed chunk ${currentChunkIndex}: ${chunkData.length} bytes (final)`);
                    
                    if (progressCallback && totalChunks !== null) {
                        console.log(`Calling progress callback: chunk ${currentChunkIndex + 1}/${totalChunks} (final)`);
                        progressCallback(currentChunkIndex, totalChunks);
                    } else {
                        console.warn('Progress callback not called (final):', {
                            hasCallback: !!progressCallback,
                            totalChunks: totalChunks
                        });
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
                    
                    // Log chunk part headers
                    console.log('=== Chunk Part Headers ===');
                    console.log('Headers:', currentPartHeaders);
                    
                    // Extract chunk index and total chunks
                    const chunkIndexHeader = currentPartHeaders['X-Chunk-Index'] || currentPartHeaders['x-chunk-index'];
                    const contentRangeHeader = currentPartHeaders['Content-Range'] || currentPartHeaders['content-range'];
                    
                    console.log('X-Chunk-Index:', chunkIndexHeader);
                    console.log('Content-Range:', contentRangeHeader);
                    
                    // Get chunk index from X-Chunk-Index or Content-Range
                    if (chunkIndexHeader) {
                        currentChunkIndex = parseInt(chunkIndexHeader, 10);
                        console.log('Chunk index from X-Chunk-Index:', currentChunkIndex);
                    } else if (contentRangeHeader) {
                        const rangeMatch = contentRangeHeader.match(/chunk\s+(\d+)\/(\d+)/i);
                        if (rangeMatch) {
                            currentChunkIndex = parseInt(rangeMatch[1], 10);
                            console.log('Chunk index from Content-Range:', currentChunkIndex);
                        }
                    }
                    
                    // Always try to extract total chunks from Content-Range if not already set
                    if (totalChunks === null && contentRangeHeader) {
                        console.log('Attempting to extract total chunks from Content-Range:', contentRangeHeader);
                        const rangeMatch = contentRangeHeader.match(/chunk\s+\d+\/(\d+)/i);
                        console.log('Content-Range regex match result:', rangeMatch);
                        if (rangeMatch) {
                            totalChunks = parseInt(rangeMatch[1], 10);
                            console.log('✓ Total chunks extracted from Content-Range:', totalChunks);
                        } else {
                            console.warn('Content-Range regex did not match. Pattern: /chunk\\s+\\d+\\/(\\d+)/i');
                        }
                    }
                    
                    if (currentChunkIndex === null) {
                        throw new Error('Could not determine chunk index from headers');
                    }
                    
                    if (totalChunks === null) {
                        console.warn('Total chunks not available from main header or Content-Range');
                    } else {
                        console.log('Total chunks available:', totalChunks);
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
                            console.log(`✓ Parsed chunk ${currentChunkIndex}: ${chunkData.length} bytes`);
                            
                            // Call progress callback
                            if (progressCallback && totalChunks !== null) {
                                console.log(`Calling progress callback: chunk ${currentChunkIndex + 1}/${totalChunks}`);
                                progressCallback(currentChunkIndex, totalChunks);
                            } else {
                                console.warn('Progress callback not called:', {
                                    hasCallback: !!progressCallback,
                                    totalChunks: totalChunks
                                });
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
                            console.log(`✓ Parsed chunk ${currentChunkIndex}: ${chunkData.length} bytes`);
                            
                            // Call progress callback
                            if (progressCallback && totalChunks !== null) {
                                console.log(`Calling progress callback: chunk ${currentChunkIndex + 1}/${totalChunks}`);
                                progressCallback(currentChunkIndex, totalChunks);
                            } else {
                                console.warn('Progress callback not called:', {
                                    hasCallback: !!progressCallback,
                                    totalChunks: totalChunks
                                });
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
    
    console.log(`Combined ${chunks.length} chunks into ${combined.length} bytes`);
    return new Blob([combined]);
}

// Helper function to complete the download (decrypt and save)
async function finishDownload(encryptedBlob: Blob, fileAesBundle: IAesBundle, fileName: string): Promise<void> {
    // Step 3: Decrypt file using AES bundle
    console.log('=== Starting File Decryption ===');
    console.log('Encrypted blob size:', encryptedBlob.size, 'bytes');
    console.log('AES bundle IV length:', fileAesBundle.iv.length);
    console.log('AES bundle key algorithm:', fileAesBundle.key.algorithm.name);
    const aesAlgorithm = fileAesBundle.key.algorithm as AesKeyAlgorithm;
    console.log('AES bundle key length:', aesAlgorithm.length);
    
    // Decrypt the file using AES bundle
    console.log('Calling decryptFile...');
    const { decryptFile } = await import('./osd-blockchain-sdk');
    const decryptedBlob = await decryptFile(encryptedBlob, fileAesBundle);
    console.log('File decrypted successfully, size:', decryptedBlob.size, 'bytes');
    
    // Step 4: Save file
    console.log('Saving file:', fileName);
    const url = URL.createObjectURL(decryptedBlob);
    const $a = $('<a>').attr({ href: url, download: fileName });
    $('body').append($a);
    $a[0].click();
    $a.remove();
    URL.revokeObjectURL(url);
    
    console.log('File downloaded successfully');
}

// Download shared file directly from storage provider
// For shared files, the encrypted file key should be included in the shared file response
export async function downloadSharedFile(
    merkleRoot: string,
    storageProviders: Array<{ provider_id?: string; provider_address?: string; providerAddress?: string }>,
    metadata: any,
    encryptedFileKeyBase64: string,
    walletAddress: string,
    $button?: JQuery<HTMLElement>
): Promise<void> {
    try {
        if (!merkleRoot) {
            throw new Error('Merkle root not found');
        }
        
        if (!encryptedFileKeyBase64) {
            throw new Error('Encrypted file key not found');
        }
        
        if (storageProviders.length === 0) {
            throw new Error('No storage providers available for this file');
        }
        
        // Decrypt file's AES bundle with recipient's private key
        const { decryptFileKeyWithECIES } = await import('./osd-blockchain-sdk');
        const fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKeyBase64, walletAddress);
        
        // Use the first available storage provider
        const provider = storageProviders[0];
        const providerAddress = provider.provider_address || provider.providerAddress;
        
        if (!providerAddress) {
            throw new Error('Storage provider address not found');
        }
        
        // Get filename from metadata
        const fileName = metadata.original_name || 'file';
        
        // Download complete file (server returns multipart with chunks)
        let downloadUrl: string;
        if (providerAddress.includes('storage.datavault.space')) {
            // Use Caddy proxy
            downloadUrl = `https://storage.datavault.space/api/storage/v1/files/download?merkle_root=${merkleRoot}`;
        } else {
            // Direct provider address
            const baseUrl = providerAddress.startsWith('http') ? providerAddress : `https://${providerAddress}`;
            downloadUrl = `${baseUrl}/api/storage/v1/files/download?merkle_root=${merkleRoot}`;
        }
        
        console.log('Downloading shared file from:', downloadUrl);
        const encryptedResponse = await fetchWithTimeout(downloadUrl, 60000, {
            method: 'GET'
        }); // 60 second timeout for file download
        
        if (!encryptedResponse.ok) {
            throw new Error(`Failed to download file: ${encryptedResponse.status} ${encryptedResponse.statusText}`);
        }
        
        // Extract metadata from response headers
        const responseFileName = encryptedResponse.headers.get('X-Original-Name') || fileName;
        const responseContentType = encryptedResponse.headers.get('X-Content-Type') || metadata.content_type;
        const totalChunksHeader = encryptedResponse.headers.get('X-Total-Chunks');
        const contentType = encryptedResponse.headers.get('Content-Type') || '';
        
        // Check if response is multipart
        if (contentType.includes('multipart/byteranges')) {
            // Parse multipart response with progress updates
            console.log('Parsing multipart response...');
            
            // Get total chunks from main response header
            const totalChunksNum = totalChunksHeader ? parseInt(totalChunksHeader, 10) : null;
            console.log('Total chunks from main response header:', totalChunksNum);
            
            // Replace button with progress bar if button is provided
            let $progressContainer: JQuery<HTMLElement> | null = null;
            const progressId = 'download-progress-' + Date.now();
            
            if ($button && $button.length > 0) {
                const $buttonContainer = $button.parent(); // div.mt-2
                $buttonContainer.html(`
                    <div class="progress" style="height: 20px; width: 100%;">
                        <div id="${progressId}" class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                            0%
                        </div>
                    </div>
                `);
                $progressContainer = $(`#${progressId}`);
            }
            
            // Progress callback
            const progressCallback = (chunkIndex: number, total: number) => {
                const progress = ((chunkIndex + 1) / total) * 100;
                console.log(`Progress update: chunk ${chunkIndex + 1}/${total} = ${Math.round(progress)}%`);
                if ($progressContainer && $progressContainer.length > 0) {
                    $progressContainer.css('width', `${progress}%`).attr('aria-valuenow', progress);
                    $progressContainer.text(`${Math.round(progress)}%`);
                }
            };
            
            const encryptedBlob = await parseMultipartResponse(encryptedResponse, contentType, totalChunksNum, progressCallback);
            console.log(`Downloaded and combined ${totalChunksHeader || 'unknown'} chunks: ${encryptedBlob.size} bytes`);
            await finishDownload(encryptedBlob, fileAesBundle, responseFileName);
        } else {
            throw new Error('Expected multipart/byteranges response but received different content type. The storage provider must return files in multipart format.');
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        showToast(`Download failed: ${errorMessage}`, 'error');
        throw error;
    }
}

// Download file from storage provider
export async function downloadFile(fileMetadata: any, walletAddress: string, $button?: JQuery<HTMLElement>): Promise<void> {
    try {
        // Handle both camelCase and snake_case for merkle root
        const merkleRoot = fileMetadata.merkleRoot || fileMetadata.merkle_root || '';
        if (!merkleRoot) {
            throw new Error('Merkle root not found in file metadata');
        }
        
        // Step 1: Query file information from indexer to get encrypted_file_key and storage providers
        const { Dashboard } = await import('./dashboard/index');
        const indexer = await Dashboard.waitForIndexer();
        
        const protocol = indexer.indexer_address.includes('localhost') || indexer.indexer_address.match(/^\d+\.\d+\.\d+\.\d+/) ? 'http' : 'https';
        const baseUrl = indexer.indexer_address.startsWith('http://') || indexer.indexer_address.startsWith('https://')
            ? indexer.indexer_address
            : `${protocol}://${indexer.indexer_address}`;
        const downloadInfoUrl = `${baseUrl}/api/indexer/v1/files/query`;
        
        console.log('Querying file info from indexer:', downloadInfoUrl);
        console.log('Request payload:', { merkle_root: merkleRoot, owner: walletAddress, requester: walletAddress });
        
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
        console.log('File download info from indexer:', downloadInfo);
        
        // Get encrypted_file_key from indexer response
        const fileData = downloadInfo.file || {};
        const encryptedFileKey = fileData.encrypted_file_key || fileData.encryptedFileKey;
        if (!encryptedFileKey) {
            throw new Error('Encrypted file key not found in indexer response. File may not be properly encrypted.');
        }
        
        // Debug: Log encrypted file key details
        console.log('=== Encrypted File Key Debug ===');
        console.log('Encrypted file key type:', typeof encryptedFileKey);
        console.log('Encrypted file key length:', encryptedFileKey.length);
        console.log('Contains pipe delimiter:', encryptedFileKey.includes('|'));
        console.log('First 50 chars:', encryptedFileKey.substring(0, 50));
        console.log('Last 50 chars:', encryptedFileKey.substring(encryptedFileKey.length - 50));
        const pipeIndex = encryptedFileKey.indexOf('|');
        if (pipeIndex > 0) {
            console.log('Encrypted IV length (hex):', pipeIndex);
            console.log('Encrypted Key length (hex):', encryptedFileKey.length - pipeIndex - 1);
        }
        
        // Decrypt file's AES bundle with owner's private key
        const { decryptFileKeyWithECIES } = await import('./osd-blockchain-sdk');
        console.log('Decrypting file key with ECIES...');
        let fileAesBundle;
        try {
            fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKey, walletAddress);
            console.log('File AES bundle decrypted successfully');
            console.log('Decrypted IV length:', fileAesBundle.iv.length);
            console.log('Decrypted key algorithm:', fileAesBundle.key.algorithm.name);
            console.log('Decrypted key extractable:', fileAesBundle.key.extractable);
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
        
        // Use the first available storage provider
        const provider = storageProviders[0];
        const providerAddress = provider.provider_address || provider.providerAddress;
        
        if (!providerAddress) {
            throw new Error('Storage provider address not found');
        }
        
        // Download complete file (server returns multipart with chunks)
        let downloadUrl: string;
        if (providerAddress.includes('storage.datavault.space')) {
            // Use Caddy proxy
            downloadUrl = `https://storage.datavault.space/api/storage/v1/files/download?merkle_root=${merkleRoot}`;
        } else {
            // Direct provider address
            const baseUrl = providerAddress.startsWith('http') ? providerAddress : `https://${providerAddress}`;
            downloadUrl = `${baseUrl}/api/storage/v1/files/download?merkle_root=${merkleRoot}`;
        }
        
        console.log('Downloading encrypted file from:', downloadUrl);
        const encryptedResponse = await fetchWithTimeout(downloadUrl, 60000, {
            method: 'GET'
        }); // 60 second timeout for file download
        
        if (!encryptedResponse.ok) {
            throw new Error(`Failed to download file: ${encryptedResponse.status} ${encryptedResponse.statusText}`);
        }
        
        // Extract metadata from response headers
        const responseFileName = encryptedResponse.headers.get('X-Original-Name') || fileName;
        const responseContentType = encryptedResponse.headers.get('X-Content-Type') || metadata.content_type;
        const totalChunksHeader = encryptedResponse.headers.get('X-Total-Chunks');
        const contentType = encryptedResponse.headers.get('Content-Type') || '';
        
        // Log all response headers for debugging
        console.log('=== Storage Provider Response Headers ===');
        console.log('Content-Type:', contentType);
        console.log('X-Total-Chunks:', totalChunksHeader);
        console.log('X-Original-Name:', encryptedResponse.headers.get('X-Original-Name'));
        console.log('X-Content-Type:', encryptedResponse.headers.get('X-Content-Type'));
        
        // Log all headers
        const allHeaders: Record<string, string> = {};
        encryptedResponse.headers.forEach((value, key) => {
            allHeaders[key] = value;
        });
        console.log('All headers:', allHeaders);
        
        console.log('File metadata from headers:', {
            fileName: responseFileName,
            contentType: responseContentType,
            totalChunks: totalChunksHeader
        });
        
        // Check if response is multipart
        if (contentType.includes('multipart/byteranges')) {
            // Parse multipart response with progress updates
            console.log('Parsing multipart response...');
            
            // Get total chunks from main response header
            const totalChunksNum = totalChunksHeader ? parseInt(totalChunksHeader, 10) : null;
            console.log('Total chunks from main response header:', totalChunksNum);
            
            // Replace button with progress bar if button is provided
            let $progressContainer: JQuery<HTMLElement> | null = null;
            const progressId = 'download-progress-' + Date.now();
            
            if ($button && $button.length > 0) {
                const $buttonContainer = $button.parent(); // div.mt-2
                $buttonContainer.html(`
                    <div class="progress" style="height: 20px; width: 100%;">
                        <div id="${progressId}" class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                            0%
                        </div>
                    </div>
                `);
                $progressContainer = $(`#${progressId}`);
            }
            
            // Progress callback
            const progressCallback = (chunkIndex: number, total: number) => {
                const progress = ((chunkIndex + 1) / total) * 100;
                console.log(`Progress update: chunk ${chunkIndex + 1}/${total} = ${Math.round(progress)}%`);
                if ($progressContainer && $progressContainer.length > 0) {
                    $progressContainer.css('width', `${progress}%`).attr('aria-valuenow', progress);
                    $progressContainer.text(`${Math.round(progress)}%`);
                }
            };
            
            const encryptedBlob = await parseMultipartResponse(encryptedResponse, contentType, totalChunksNum, progressCallback);
            console.log(`Downloaded and combined ${totalChunksHeader || 'unknown'} chunks: ${encryptedBlob.size} bytes`);
            await finishDownload(encryptedBlob, fileAesBundle, responseFileName);
        } else {
            throw new Error('Expected multipart/byteranges response but received different content type. The storage provider must return files in multipart format.');
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        showToast(`Download failed: ${errorMessage}`, 'error');
        throw error;
    }
}

