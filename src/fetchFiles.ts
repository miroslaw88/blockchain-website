// Fetch files from blockchain

import { getKeplr, CHAIN_ID, deriveECIESPrivateKey } from './utils';

// Show toast notification
function showToast(message: string, type: 'error' | 'success' | 'info' = 'error'): void {
    const $container = $('#toastContainer');
    if ($container.length === 0) {
        // Create container if it doesn't exist
        $('body').append('<div class="toast-container" id="toastContainer"></div>');
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
async function fetchWithTimeout(url: string, timeout: number = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });
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

// Calculate Merkle root (SHA256 hash) - needed for decryption
async function calculateMerkleRoot(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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


// Decrypt file using chunked AES-256-GCM with ECIES key derivation (OSD system-style)
async function decryptFile(encryptedBlob: Blob, userAddress: string, originalFileHash: string): Promise<Blob> {
    // Derive ECIES private key from wallet signature (same as encryption)
    const eciesKeyMaterial = await deriveECIESPrivateKey(userAddress);
    
    // Derive AES-256-GCM key from ECIES private key material (same as encryption)
    const aesKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(0),
            iterations: 10000,
            hash: 'SHA-256'
        },
        eciesKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
    // Read encrypted data
    const encryptedData = await encryptedBlob.arrayBuffer();
    const encryptedArray = new Uint8Array(encryptedData);
    
    const decryptedChunks: Blob[] = [];
    let offset = 0;
    
    // Decrypt chunks
    while (offset < encryptedArray.length) {
        // Read 8-byte size header
        if (offset + 8 > encryptedArray.length) {
            throw new Error('Invalid encrypted file format: incomplete size header');
        }
        
        const sizeHeaderBytes = encryptedArray.slice(offset, offset + 8);
        const sizeHeader = new TextDecoder().decode(sizeHeaderBytes);
        const chunkSize = parseInt(sizeHeader, 10);
        
        if (isNaN(chunkSize) || chunkSize <= 0) {
            throw new Error(`Invalid chunk size header: ${sizeHeader}`);
        }
        
        offset += 8;
        
        // Validate we have enough data for this chunk
        if (offset + chunkSize > encryptedArray.length) {
            throw new Error(`Invalid encrypted file format: incomplete chunk (expected ${chunkSize} bytes)`);
        }
        
        // Extract IV (12 bytes) and encrypted chunk + tag
        const chunkData = encryptedArray.slice(offset, offset + chunkSize);
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
                tagLength: 128 // 128-bit authentication tag
            },
            aesKey,
            ciphertextWithTag
        );
        
        decryptedChunks.push(new Blob([decryptedChunkData]));
        offset += chunkSize;
    }
    
    // Combine all decrypted chunks into single blob
    return new Blob(decryptedChunks);
}

// Get file icon based on content type
function getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    } else if (contentType.startsWith('video/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    } else if (contentType.startsWith('audio/')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    } else if (contentType.includes('pdf')) {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    } else {
        return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    }
}

// Format file size
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Format date as YYYY-MM-DD with time
function formatDate(timestamp: number): string {
    if (!timestamp || timestamp === 0) {
        return 'N/A';
    }
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString();
    return `${year}-${month}-${day} ${time}`;
}

// Download file from storage provider
async function downloadFile(fileMetadata: any, walletAddress: string, $button?: JQuery<HTMLElement>): Promise<void> {
    try {
        // Step 1: Query file information from blockchain
        const apiEndpoint = 'https://storage.datavault.space';
        // Handle both camelCase and snake_case for merkle root
        const merkleRoot = fileMetadata.merkleRoot || fileMetadata.merkle_root || '';
        if (!merkleRoot) {
            throw new Error('Merkle root not found in file metadata');
        }
        
        const downloadInfoUrl = `${apiEndpoint}/osd-blockchain/osdblockchain/v1/file/${merkleRoot}/download?owner=${walletAddress}`;
        
        console.log('Querying file info from:', downloadInfoUrl);
        
        const infoResponse = await fetchWithTimeout(downloadInfoUrl, 15000);
        if (!infoResponse.ok) {
            throw new Error(`Failed to query file info: ${infoResponse.status} ${infoResponse.statusText}`);
        }
        
        const downloadInfo = await infoResponse.json();
        console.log('File download info:', downloadInfo);
        
        // Parse metadata (handle both camelCase and snake_case)
        const fileData = downloadInfo.file || {};
        const metadataStr = fileData.metadata || '';
        const metadata: any = JSON.parse(metadataStr || '{}');
        
        // Get filename from original_name (hashed format stores original in original_name)
        const fileName = metadata.original_name || 'file';
        
        const originalFileHash = metadata.original_file_hash;
        
        if (!originalFileHash) {
            throw new Error('Original file hash not found in metadata. This file may have been uploaded before hash storage was implemented.');
        }
        
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
            downloadUrl = `https://storage.datavault.space/api/v1/files/download?merkle_root=${merkleRoot}`;
        } else {
            // Direct provider address
            const baseUrl = providerAddress.startsWith('http') ? providerAddress : `https://${providerAddress}`;
            downloadUrl = `${baseUrl}/api/v1/files/download?merkle_root=${merkleRoot}`;
        }
        
        console.log('Downloading encrypted file from:', downloadUrl);
        const encryptedResponse = await fetchWithTimeout(downloadUrl, 60000); // 60 second timeout for file download
        
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
            await finishDownload(encryptedBlob, originalFileHash, walletAddress, responseFileName);
        } else {
            // Fallback: treat as single blob (for backwards compatibility, though we said no backwards compat)
            // Actually, if it's not multipart, it might be an error or different format
            console.warn('Response is not multipart, treating as single blob');
            const encryptedBlob = await encryptedResponse.blob();
            console.log(`Downloaded encrypted file: ${encryptedBlob.size} bytes`);
            await finishDownload(encryptedBlob, originalFileHash, walletAddress, responseFileName);
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        showToast(`Download failed: ${errorMessage}`, 'error');
        throw error;
    }
}

// Helper function to complete the download (decrypt and save)
async function finishDownload(encryptedBlob: Blob, originalFileHash: string, walletAddress: string, fileName: string): Promise<void> {
    // Step 3: Decrypt file using private key
    console.log('Decrypting file...');
    
    // Use the walletAddress parameter directly (same format as used for caching)
    // This ensures we use the same address format that was used to cache the ECIES key
    const keplr = getKeplr();
    if (!keplr) {
        throw new Error('Keplr not available');
    }
    
    await keplr.enable(CHAIN_ID);
    // Get the bech32Address to match the format used during wallet connection
    const key = await (keplr as any).getKey(CHAIN_ID);
    const userAddress = key.bech32Address;
    
    // Decrypt the file using private key (signature-based)
    const decryptedBlob = await decryptFile(encryptedBlob, userAddress, originalFileHash);
    
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

// Fetch files from blockchain
export async function fetchFiles(walletAddress: string): Promise<void> {
    const $contentArea = $('#contentArea');
    if ($contentArea.length === 0) return;

    // Show loading state
    $contentArea.html('<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading files...</p><p class="text-muted small">This may take a few seconds...</p></div>');

    try {
        // Construct API URL with wallet address
        // Use HTTPS through Caddy reverse proxy (routes /osd-blockchain to localhost:1337)
        const apiEndpoint = 'https://storage.datavault.space';
        const apiUrl = `${apiEndpoint}/osd-blockchain/osdblockchain/v1/files/owner/${walletAddress}`;
        
        console.log('Fetching from:', apiUrl);
        
        // Fetch data from blockchain with 15 second timeout
        const response = await fetchWithTimeout(apiUrl, 15000);
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            let errorMessage = `HTTP error! status: ${response.status}`;
            
            // Try to parse error response
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.code === 12 || response.status === 501) {
                    errorMessage = `Not Implemented (code 12): The endpoint may not be implemented or Caddy is not routing correctly.`;
                    errorMessage += `\n\nTried: ${apiUrl}`;
                    errorMessage += `\n\nCheck:`;
                    errorMessage += `\n1. Caddyfile has route: handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }`;
                    errorMessage += `\n2. Test directly: curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}`;
                    errorMessage += `\n3. Verify blockchain API server implements this endpoint`;
                } else {
                    errorMessage = `HTTP error! status: ${response.status}, code: ${errorJson.code || 'N/A'}, message: ${errorJson.message || errorText}`;
                }
            } catch {
                errorMessage = `HTTP error! status: ${response.status}, message: ${errorText}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // Parse files array (assuming response is an object with a 'files' array or the response itself is an array)
        const files = Array.isArray(data) ? data : (data.files || []);
        
        // Display files as thumbnails
        if (files.length === 0) {
            $contentArea.html(`
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">Files for ${walletAddress}</h5>
                    </div>
                    <div class="card-body text-center py-5">
                        <p class="text-muted">No files found</p>
                    </div>
                </div>
            `);
            return;
        }
        
        // Generate thumbnail grid
        const filesGrid = files.map((file: any) => {
            // Parse metadata
            let metadata: any = { content_type: 'application/octet-stream' };
            try {
                metadata = JSON.parse(file.metadata || '{}');
            } catch (e) {
                console.warn('Failed to parse metadata:', e);
            }
            
            // Get filename from original_name (hashed format stores original in original_name)
            const fileName = metadata.original_name || 'Unknown File';
            const contentType = metadata.content_type || 'application/octet-stream';
            // Handle both camelCase and snake_case from API
            const fileSize = formatFileSize((file.sizeBytes || file.size_bytes || 0));
            const uploadDate = formatDate((file.uploadedAt || file.uploaded_at || 0));
            const expirationDate = formatDate((file.expirationTime || file.expiration_time || 0));
            const expirationTimestamp = file.expirationTime || file.expiration_time || 0;
            const isExpired = expirationTimestamp && expirationTimestamp < Math.floor(Date.now() / 1000);
            // Handle both camelCase and snake_case for merkle root
            const merkleRoot = file.merkleRoot || file.merkle_root || '';
            
            return `
                <div class="col-md-3 col-sm-4 col-6 mb-4">
                    <div class="card h-100 file-thumbnail ${isExpired ? 'border-warning' : ''}" style="transition: transform 0.2s;">
                        <div class="card-body text-center p-3">
                            <div class="file-icon mb-2" style="color: #6c757d;">
                                ${getFileIcon(contentType)}
                            </div>
                            <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${fileName}">${fileName}</h6>
                            <p class="text-muted small mb-1">${fileSize}</p>
                            ${isExpired ? '<span class="badge bg-warning text-dark mb-2">Expired</span>' : ''}
                            <div class="mt-2">
                                <button class="btn btn-sm btn-primary download-btn" data-merkle-root="${merkleRoot}" data-file-name="${fileName}" title="Download">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="card-footer bg-transparent border-0 pt-0 pb-2">
                            <small class="text-muted d-block" style="font-size: 0.75rem;">Uploaded: ${uploadDate}</small>
                            <small class="text-muted d-block" style="font-size: 0.75rem;">Expires: ${expirationDate}</small>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        $contentArea.html(`
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Files (${files.length})</h5>
                    <small class="text-muted">${walletAddress}</small>
                </div>
                <div class="card-body">
                    <div class="row">
                        ${filesGrid}
                    </div>
                </div>
            </div>
        `);
        
        // Add event listeners to download buttons using event delegation
        // This ensures handlers work even after buttons are restored
        // Remove any existing handlers first to prevent duplicates
        $contentArea.off('click', '.download-btn');
        $contentArea.on('click', '.download-btn', async function(e) {
            e.preventDefault();
            const $button = $(this);
            const merkleRoot = $button.attr('data-merkle-root');
            const fileName = $button.attr('data-file-name') || 'file';
            
            if (!merkleRoot) {
                showToast('File identifier not found', 'error');
                return;
            }
            
            // Create a minimal file object with just the merkle root
            // downloadFile will query the full file info from the blockchain
            const fileMetadata = {
                merkleRoot: merkleRoot,
                merkle_root: merkleRoot
            };
            
            // Replace button with progress bar
            const $buttonContainer = $button.parent(); // div.mt-2
            const originalHTML = $buttonContainer.html();
            
            try {
                await downloadFile(fileMetadata, walletAddress, $button);
            } finally {
                // Restore button
                $buttonContainer.html(originalHTML);
            }
        });
        
        // Add hover effect to thumbnails
        $contentArea.find('.file-thumbnail').on({
            mouseenter: function() {
                $(this).css({ transform: 'translateY(-5px)', boxShadow: '0 4px 8px rgba(0,0,0,0.1)' });
            },
            mouseleave: function() {
                $(this).css({ transform: 'translateY(0)', boxShadow: '' });
            }
        });
    } catch (error) {
        // Display detailed error
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch files';
        console.error('Fetch error:', error);
        
        $contentArea.html(`
            <div class="alert alert-danger" role="alert">
                <h5 class="alert-heading">Error Fetching Files</h5>
                <p><strong>Error:</strong> ${errorMessage}</p>
                <hr>
                <p class="mb-1"><strong>Troubleshooting:</strong></p>
                <ul class="mb-0">
                    <li><strong>Code 12 / Status 501:</strong> This usually means Caddy isn't routing the request to your blockchain API server. Check your Caddyfile configuration.</li>
                    <li>Ensure your blockchain node is running on <code>localhost:1337</code></li>
                    <li>Verify Caddyfile has: <code>handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }</code></li>
                    <li>Test the endpoint directly: <code>curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}</code></li>
                    <li>Reload Caddy after config changes: <code>sudo systemctl reload caddy</code></li>
                    <li>Check Caddy logs: <code>sudo journalctl -u caddy -f</code></li>
                </ul>
            </div>
        `);
    }
}

