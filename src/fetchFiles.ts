// Fetch files from blockchain

import { downloadFile } from './downloadFile';

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

// Get folder icon
function getFolderIcon(): string {
    return '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
}

// Build breadcrumb navigation HTML
function buildBreadcrumbs(currentPath: string): string {
    if (!currentPath || currentPath === '' || currentPath === '/') {
        // Root directory - no breadcrumbs needed
        return '';
    }
    
    // Split path into segments
    const segments = currentPath.split('/').filter(seg => seg !== '');
    
    // Build breadcrumb items
    let breadcrumbItems = '<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="">Root</a></li>';
    
    let accumulatedPath = '';
    segments.forEach((segment, index) => {
        accumulatedPath += '/' + segment;
        // Ensure directory paths end with /
        const pathForNavigation = accumulatedPath + (index < segments.length - 1 ? '/' : '');
        
        const isLast = index === segments.length - 1;
        if (isLast) {
            breadcrumbItems += `<li class="breadcrumb-item active" aria-current="page">${segment}</li>`;
        } else {
            breadcrumbItems += `<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="${pathForNavigation}">${segment}</a></li>`;
        }
    });
    
    return `
        <nav aria-label="breadcrumb">
            <ol class="breadcrumb mb-0">
                ${breadcrumbItems}
            </ol>
        </nav>
    `;
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


// Fetch files from blockchain
// path: Optional path to navigate into a specific folder (e.g., "/test/")
export async function fetchFiles(walletAddress: string, path: string = ''): Promise<void> {
    const $contentArea = $('#contentArea');
    if ($contentArea.length === 0) return;

    // Show loading state
    $contentArea.html('<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading files...</p><p class="text-muted small">This may take a few seconds...</p></div>');

    try {
        // Construct API URL with wallet address and path parameter
        // Use HTTPS through Caddy reverse proxy (routes /osd-blockchain to localhost:1337)
        // API endpoint: /osd-blockchain/osdblockchain/v1/files/owner/{owner}?path={path}
        const apiEndpoint = 'https://storage.datavault.space';
        
        // Normalize and encode the path parameter
        // Always include path parameter ("/" for root directory, otherwise use provided path)
        let normalizedPath = path ? path.trim() : '';
        // If path is empty or just whitespace, use "/" for root directory
        // Also ensure we don't have double slashes
        if (!normalizedPath || normalizedPath === '') {
            normalizedPath = '/';
        } else if (normalizedPath.startsWith('//')) {
            // Fix double slash at start
            normalizedPath = normalizedPath.replace(/^\/+/, '/');
        }
        const encodedPath = encodeURIComponent(normalizedPath);
        
        const apiUrl = `${apiEndpoint}/osd-blockchain/osdblockchain/v1/files/owner/${walletAddress}?path=${encodedPath}`;
        
        console.log('Fetching from:', apiUrl);
        console.log('Path parameter:', normalizedPath);
        
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
        
        // Parse entries array - API returns {"path": "", "entries": [...]}
        // Each entry has a type field: "file" or "directory"
        const entries: Array<{
            type: 'file' | 'directory';
            name: string;
            path: string;
            merkle_root?: string;
            owner?: string;
            size_bytes?: string;
            expiration_time?: string;
            max_proofs?: string;
            metadata?: string;
            uploaded_at?: string;
        }> = data.entries || [];
        
        // Store current path in sessionStorage for uploads (even if no entries)
        // Normalize the path: use "/" for root, ensure no double slashes
        let currentPath = data.path || path || '';
        if (!currentPath || currentPath === '') {
            currentPath = '/';
        } else if (currentPath.startsWith('//')) {
            // Fix double slash at start
            currentPath = currentPath.replace(/^\/+/, '/');
        }
        sessionStorage.setItem('currentDirectoryPath', currentPath);
        
        // Display entries as thumbnails
        if (entries.length === 0) {
            $contentArea.html(`
                <div class="card">
                    <div class="card-header">
                        <h5 class="mb-0">Files and Folders for ${walletAddress}</h5>
                    </div>
                    <div class="card-body text-center py-5">
                        <p class="text-muted">No files or folders found</p>
                    </div>
                </div>
            `);
            return;
        }
        
        // Count files and directories
        const fileCount = entries.filter(e => e.type === 'file').length;
        const directoryCount = entries.filter(e => e.type === 'directory').length;
        
        // Build breadcrumb navigation (currentPath already defined above)
        const breadcrumbs = buildBreadcrumbs(currentPath);
        
        // Generate thumbnail grid
        const entriesGrid = entries.map((entry: any) => {
            if (entry.type === 'file') {
                // Handle file entry
                // Parse metadata
                let metadata: any = { content_type: 'application/octet-stream' };
                try {
                    metadata = JSON.parse(entry.metadata || '{}');
                } catch (e) {
                    console.warn('Failed to parse metadata:', e);
                }
                
                // Get filename from original_name (hashed format stores original in original_name)
                const fileName = metadata.original_name || entry.name || 'Unknown File';
                const contentType = metadata.content_type || 'application/octet-stream';
                // Handle both camelCase and snake_case from API
                const sizeBytes = parseInt(entry.size_bytes || entry.sizeBytes || '0', 10);
                const fileSize = formatFileSize(sizeBytes);
                const uploadDate = formatDate(parseInt(entry.uploaded_at || entry.uploadedAt || '0', 10));
                const expirationDate = formatDate(parseInt(entry.expiration_time || entry.expirationTime || '0', 10));
                const expirationTimestamp = parseInt(entry.expiration_time || entry.expirationTime || '0', 10);
                const isExpired = expirationTimestamp && expirationTimestamp < Math.floor(Date.now() / 1000);
                // Handle both camelCase and snake_case for merkle root
                const merkleRoot = entry.merkle_root || entry.merkleRoot || '';
                
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
            } else if (entry.type === 'directory') {
                // Handle directory entry
                const folderName = entry.name || 'Unknown Folder';
                const folderPath = entry.path || '';
                
                return `
                    <div class="col-md-3 col-sm-4 col-6 mb-4">
                        <div class="card h-100 file-thumbnail folder-thumbnail" style="transition: transform 0.2s; cursor: pointer;" data-folder-path="${folderPath}">
                            <div class="card-body text-center p-3">
                                <div class="file-icon mb-2" style="color: #ffc107;">
                                    ${getFolderIcon()}
                                </div>
                                <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${folderName}">${folderName}</h6>
                                <p class="text-muted small mb-1">Folder</p>
                                <div class="mt-2">
                                    <span class="badge bg-info">Directory</span>
                                </div>
                            </div>
                            <div class="card-footer bg-transparent border-0 pt-0 pb-2">
                                <small class="text-muted d-block" style="font-size: 0.75rem;">Path: ${folderPath}</small>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Unknown type - skip
                return '';
            }
        }).filter(html => html !== '').join('');
        
        $contentArea.html(`
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Files and Folders (${fileCount} files, ${directoryCount} folders)</h5>
                    <small class="text-muted">${walletAddress}</small>
                </div>
                <div class="card-body">
                    ${breadcrumbs}
                    <div class="row mt-3">
                        ${entriesGrid}
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
        
        // Add click handler for folder thumbnails - navigate into folder
        // Remove any existing handlers first to prevent duplicates
        $contentArea.off('click', '.folder-thumbnail');
        $contentArea.on('click', '.folder-thumbnail', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent event bubbling
            const $folder = $(this);
            const folderPath = $folder.attr('data-folder-path');
            if (folderPath) {
                // Trim the path to remove any trailing spaces
                const trimmedPath = folderPath.trim();
                console.log('Navigating to folder:', trimmedPath);
                // Navigate into the folder
                fetchFiles(walletAddress, trimmedPath);
            }
        });
        
        // Add click handler for breadcrumb navigation
        $contentArea.off('click', '.breadcrumb-link');
        $contentArea.on('click', '.breadcrumb-link', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $breadcrumb = $(this);
            let targetPath = $breadcrumb.attr('data-path') || '';
            // Normalize: if empty string, use "/" for root
            if (targetPath === '') {
                targetPath = '/';
            }
            console.log('Navigating to path:', targetPath);
            fetchFiles(walletAddress, targetPath);
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

