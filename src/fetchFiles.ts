// Fetch files from blockchain

import { getKeplr, CHAIN_ID, deriveECIESPrivateKey } from './utils';

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


// Decrypt file using AES-256-GCM with ECIES key derivation
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
    
    // Validate encrypted data size (must have at least 12 bytes for IV)
    if (encryptedData.byteLength < 12) {
        throw new Error('Encrypted file is too small (missing IV)');
    }
    
    const encryptedArray = new Uint8Array(encryptedData);
    
    // Extract IV (first 12 bytes) and encrypted content + tag (rest)
    const iv = encryptedArray.slice(0, 12);
    const ciphertextWithTag = encryptedArray.slice(12);
    
    // Validate ciphertext size (must have at least 16 bytes for authentication tag)
    if (ciphertextWithTag.length < 16) {
        throw new Error('Encrypted file is too small (missing authentication tag)');
    }
    
    // Decrypt with AES-GCM (automatically verifies authentication tag)
    const decryptedData = await crypto.subtle.decrypt(
        { 
            name: 'AES-GCM',
            iv: iv,
            tagLength: 128 // 128-bit authentication tag
        },
        aesKey,
        ciphertextWithTag
    );
    
    return new Blob([decryptedData]);
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

// Format date
function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

// Download file from storage provider
async function downloadFile(fileMetadata: any, walletAddress: string): Promise<void> {
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
        const metadata = JSON.parse(metadataStr || '{}');
        const fileName = metadata.name || 'file';
        const originalFileHash = metadata.original_file_hash;
        
        if (!originalFileHash) {
            throw new Error('Original file hash not found in metadata. This file may have been uploaded before hash storage was implemented.');
        }
        
        // Step 2: Download encrypted file from storage provider
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
        
        // Construct download URL - format: https://{provider_address}/api/v1/files/download?merkle_root={merkle_root}
        let downloadUrl: string;
        if (providerAddress.includes('storage.datavault.space')) {
            // Use Caddy proxy
            downloadUrl = `https://storage.datavault.space/api/v1/files/download?merkle_root=${merkleRoot}`;
        } else {
            // Direct provider address - try HTTPS first, fallback to HTTP
            const baseUrl = providerAddress.startsWith('http') ? providerAddress : `https://${providerAddress}`;
            downloadUrl = `${baseUrl}/api/v1/files/download?merkle_root=${merkleRoot}`;
        }
        
        console.log('Downloading encrypted file from:', downloadUrl);
        
        const encryptedResponse = await fetchWithTimeout(downloadUrl, 60000); // 60 second timeout for file download
        if (!encryptedResponse.ok) {
            // Try HTTP if HTTPS failed
            if (downloadUrl.startsWith('https://') && !providerAddress.includes('storage.datavault.space')) {
                const httpUrl = downloadUrl.replace('https://', 'http://');
                console.log('HTTPS failed, trying HTTP:', httpUrl);
                const httpResponse = await fetchWithTimeout(httpUrl, 60000);
                if (!httpResponse.ok) {
                    throw new Error(`Failed to download file: ${encryptedResponse.status} ${encryptedResponse.statusText}`);
                }
                const encryptedBlob = await httpResponse.blob();
                await finishDownload(encryptedBlob, originalFileHash, walletAddress, fileName);
            } else {
                throw new Error(`Failed to download file: ${encryptedResponse.status} ${encryptedResponse.statusText}`);
            }
        } else {
            const encryptedBlob = await encryptedResponse.blob();
            await finishDownload(encryptedBlob, originalFileHash, walletAddress, fileName);
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        alert(`Download failed: ${errorMessage}`);
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
            let metadata = { name: 'Unknown File', content_type: 'application/octet-stream' };
            try {
                metadata = JSON.parse(file.metadata || '{}');
            } catch (e) {
                console.warn('Failed to parse metadata:', e);
            }
            
            const fileName = metadata.name || 'Unknown File';
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
        
        // Add event listeners to download buttons
        $contentArea.find('.download-btn').on('click', async function(e) {
            e.preventDefault();
            const $button = $(this);
            const merkleRoot = $button.attr('data-merkle-root');
            const fileName = $button.attr('data-file-name') || 'file';
            
            if (!merkleRoot) {
                alert('File identifier not found');
                return;
            }
            
            // Find the file metadata (handle both camelCase and snake_case)
            const file = files.find((f: any) => {
                const fMerkleRoot = f.merkleRoot || f.merkle_root;
                return fMerkleRoot === merkleRoot;
            });
            if (!file) {
                alert('File not found');
                return;
            }
            
            // Disable button and show loading
            $button.prop('disabled', true);
            const originalHTML = $button.html();
            $button.html('<span class="spinner-border spinner-border-sm"></span>');
            
            try {
                await downloadFile(file, walletAddress);
            } finally {
                $button.prop('disabled', false);
                $button.html(originalHTML);
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

