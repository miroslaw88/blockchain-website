// Fetch files from blockchain

import { getKeplr, CHAIN_ID } from './utils';

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

// Decrypt file using wallet signature (reverse of encryption)
async function decryptFile(encryptedBlob: Blob, userAddress: string, originalFileHash: string): Promise<Blob> {
    const keplr = getKeplr();
    if (!keplr || !keplr.signArbitrary) {
        throw new Error('Keplr signArbitrary not available');
    }

    // Create the same message that was used for encryption
    const messageToSign = `File encryption: ${originalFileHash}`;
    
    // Request signature from Keplr (same signature as encryption)
    const signatureResult = await keplr.signArbitrary(CHAIN_ID, userAddress, messageToSign);
    
    // Derive decryption key from signature (same process as encryption)
    const signatureBytes = Uint8Array.from(atob(signatureResult.signature), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        signatureBytes.slice(0, 32),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );
    
    // Derive AES key (same parameters as encryption)
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(0),
            iterations: 10000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-CBC', length: 256 },
        false,
        ['decrypt'] // Note: decrypt instead of encrypt
    );
    
    // Read encrypted data
    const encryptedData = await encryptedBlob.arrayBuffer();
    const encryptedArray = new Uint8Array(encryptedData);
    
    // Extract IV (first 16 bytes) and encrypted content (rest)
    const iv = encryptedArray.slice(0, 16);
    const ciphertext = encryptedArray.slice(16);
    
    // Decrypt
    const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv },
        key,
        ciphertext
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
        // Parse metadata
        const metadata = JSON.parse(fileMetadata.metadata || '{}');
        const fileName = metadata.name || 'file';
        const contentType = metadata.content_type || 'application/octet-stream';
        
        // For now, we need to query the blockchain to get storage providers for this file
        // This is a simplified version - in production you'd query the blockchain for providers
        const apiEndpoint = 'https://storage.datavault.space';
        
        // Try to download from storage provider
        // Note: This assumes we can construct the download URL from merkle root
        // You may need to query the blockchain first to get the provider address
        const downloadUrl = `${apiEndpoint}/api/v1/files/download/${fileMetadata.merkleRoot}`;
        
        console.log('Downloading file from:', downloadUrl);
        
        // Fetch encrypted file
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }
        
        const encryptedBlob = await response.blob();
        
        // Calculate original file hash from metadata (we need this for decryption)
        // Note: We need the original file hash, but we only have the encrypted file hash (merkleRoot)
        // This is a limitation - we may need to store the original hash separately or use a different approach
        // For now, we'll try to decrypt using the merkle root as a reference
        // In practice, you might need to query additional metadata or use a different key derivation
        
        // Get user address for decryption
        const keplr = getKeplr();
        if (!keplr) {
            throw new Error('Keplr not available');
        }
        
        await keplr.enable(CHAIN_ID);
        const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
        const accounts = await offlineSigner.getAccounts();
        const userAddress = accounts[0].address;
        
        // Note: We need the original file hash to decrypt, but we only have the encrypted file's merkle root
        // This is a design limitation. For now, we'll show an error message explaining this.
        // In a production system, you'd need to either:
        // 1. Store the original file hash in metadata
        // 2. Use a deterministic key derivation that doesn't require the original hash
        // 3. Query additional information from the blockchain
        
        throw new Error('File decryption requires original file hash. This feature needs additional implementation.');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error('Download error:', error);
        alert(`Download failed: ${errorMessage}`);
    }
}

// Fetch files from blockchain
export async function fetchFiles(walletAddress: string): Promise<void> {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    // Show loading state
    contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading files...</p><p class="text-muted small">This may take a few seconds...</p></div>';

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
            contentArea.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">Files for ${walletAddress}</h5>
                    </div>
                    <div class="card-body text-center py-5">
                        <p class="text-muted">No files found</p>
                    </div>
                </div>
            `;
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
            const fileSize = formatFileSize(file.sizeBytes || 0);
            const uploadDate = formatDate(file.uploadedAt || 0);
            const expirationDate = formatDate(file.expirationTime || 0);
            const isExpired = file.expirationTime && file.expirationTime < Math.floor(Date.now() / 1000);
            
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
                                <button class="btn btn-sm btn-primary download-btn" data-merkle-root="${file.merkleRoot}" data-file-name="${fileName}" title="Download">
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
        
        contentArea.innerHTML = `
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
        `;
        
        // Add event listeners to download buttons
        const downloadButtons = contentArea.querySelectorAll('.download-btn');
        downloadButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const button = e.currentTarget as HTMLButtonElement;
                const merkleRoot = button.getAttribute('data-merkle-root');
                const fileName = button.getAttribute('data-file-name') || 'file';
                
                if (!merkleRoot) {
                    alert('File identifier not found');
                    return;
                }
                
                // Find the file metadata
                const file = files.find((f: any) => f.merkleRoot === merkleRoot);
                if (!file) {
                    alert('File not found');
                    return;
                }
                
                // Disable button and show loading
                button.disabled = true;
                const originalHTML = button.innerHTML;
                button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
                
                try {
                    await downloadFile(file, walletAddress);
                } finally {
                    button.disabled = false;
                    button.innerHTML = originalHTML;
                }
            });
        });
        
        // Add hover effect to thumbnails
        const thumbnails = contentArea.querySelectorAll('.file-thumbnail');
        thumbnails.forEach(thumb => {
            thumb.addEventListener('mouseenter', () => {
                (thumb as HTMLElement).style.transform = 'translateY(-5px)';
                (thumb as HTMLElement).style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
            });
            thumb.addEventListener('mouseleave', () => {
                (thumb as HTMLElement).style.transform = 'translateY(0)';
                (thumb as HTMLElement).style.boxShadow = '';
            });
        });
    } catch (error) {
        // Display detailed error
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch files';
        console.error('Fetch error:', error);
        
        contentArea.innerHTML = `
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
        `;
    }
}

