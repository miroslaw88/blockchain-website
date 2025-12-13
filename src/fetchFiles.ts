// Fetch files from blockchain

import { downloadFile } from './downloadFile';
import { createDirectory } from './createDirectory';
import { deleteFile } from './deleteFile';
import { deleteDirectory } from './deleteDirectory';
import { formatDate } from './utils';
import {
    getFilesViewTemplate,
    getEmptyStateTemplate,
    getFileThumbnailTemplate,
    getFolderThumbnailTemplate,
    getEntriesGridTemplate,
    getCreateFolderModalTemplate,
    getDeleteFileModalTemplate,
    getDeleteFolderModalTemplate,
    getErrorTemplate,
    getLoadingTemplate
} from './templates';

// Show toast notification
export function showToast(message: string, type: 'error' | 'success' | 'info' = 'error'): void {
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

// Fetch files from blockchain
// path: Optional path to navigate into a specific folder (e.g., "/test/")
export async function fetchFiles(walletAddress: string, path: string = ''): Promise<void> {
    const $contentArea = $('#contentArea');
    if ($contentArea.length === 0) return;

    // Show loading state
    $contentArea.html(getLoadingTemplate());

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
        
        // Build breadcrumb navigation (needed for both empty and non-empty states)
        const breadcrumbs = buildBreadcrumbs(currentPath);
        
        // Count files and directories (needed for both empty and non-empty states)
        const fileCount = entries.filter(e => e.type === 'file').length;
        const directoryCount = entries.filter(e => e.type === 'directory').length;
        
        // Check if the files view template already exists
        const $existingCard = $contentArea.find('.card');
        const $filesViewCard = $existingCard.filter((i, el) => {
            return $(el).find('#createFolderToolbarBtn').length > 0;
        });
        
        // If template doesn't exist, create it
        if ($filesViewCard.length === 0) {
            $contentArea.html(getFilesViewTemplate(walletAddress));
            
            // Set up event handlers once (they'll persist)
            $contentArea.off('click', '#createFolderToolbarBtn');
            $contentArea.on('click', '#createFolderToolbarBtn', function(e) {
                e.preventDefault();
                const currentPath = sessionStorage.getItem('currentDirectoryPath') || '/';
                showCreateFolderModal(walletAddress, currentPath);
            });
        }
        
        // Update dynamic parts of the template
        // 1. Update header with file/folder counts
        $('#filesViewHeader').text(`Files and Folders (${fileCount} files, ${directoryCount} folders)`);
        
        // 2. Update wallet address (in case it changed)
        $('#filesViewWalletAddress').text(walletAddress);
        
        // 3. Update breadcrumbs
        $('#filesViewBreadcrumbs').html(breadcrumbs);
        
        // 4. Update content area (files/folders list)
        const $contentAreaInner = $('#filesViewContent');
        
        // Display entries as thumbnails
        if (entries.length === 0) {
            $contentAreaInner.html(getEmptyStateTemplate());
            
            // Re-attach event handlers (they may have been removed)
            attachEventHandlers(walletAddress, currentPath);
            return;
        }
        
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
                const isExpired = Boolean(expirationTimestamp && expirationTimestamp < Math.floor(Date.now() / 1000));
                // Handle both camelCase and snake_case for merkle root
                const merkleRoot = entry.merkle_root || entry.merkleRoot || '';
                
                return getFileThumbnailTemplate(
                    fileName,
                    fileSize,
                    uploadDate,
                    expirationDate,
                    merkleRoot,
                    contentType,
                    isExpired,
                    getFileIcon(contentType)
                );
            } else if (entry.type === 'directory') {
                // Handle directory entry
                const folderName = entry.name || 'Unknown Folder';
                const folderPath = entry.path || '';
                
                return getFolderThumbnailTemplate(
                    folderName,
                    folderPath,
                    getFolderIcon()
                );
            } else {
                // Unknown type - skip
                return '';
            }
        }).filter(html => html !== '').join('');
        
        // Update the content area with the entries grid
        $contentAreaInner.html(getEntriesGridTemplate(entriesGrid));
        
        // Attach event handlers (using event delegation, so they persist)
        attachEventHandlers(walletAddress, currentPath);
    } catch (error) {
        // Display detailed error
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch files';
        console.error('Fetch error:', error);
        
        $contentArea.html(getErrorTemplate(errorMessage));
    }
}

// Helper function to attach event handlers (using event delegation)
function attachEventHandlers(walletAddress: string, currentPath: string): void {
    const $contentArea = $('#contentArea');
    
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
    $contentArea.find('.file-thumbnail').off('mouseenter mouseleave');
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
        // Don't navigate if clicking on the delete button
        if ($(e.target).closest('.delete-folder-btn').length > 0) {
            return;
        }
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
    
    // Add click handler for delete file buttons
    $contentArea.off('click', '.delete-file-btn');
    $contentArea.on('click', '.delete-file-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $button = $(this);
        const merkleRoot = $button.attr('data-merkle-root');
        const fileName = $button.attr('data-file-name') || 'file';
        
        if (!merkleRoot) {
            showToast('File identifier not found', 'error');
            return;
        }
        
        // Show delete confirmation modal
        showDeleteFileModal(merkleRoot, fileName, walletAddress, currentPath);
    });
    
    // Add click handler for delete folder buttons
    $contentArea.off('click', '.delete-folder-btn');
    $contentArea.on('click', '.delete-folder-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $button = $(this);
        const folderPath = $button.attr('data-folder-path');
        const folderName = $button.attr('data-folder-name') || 'folder';
        
        if (!folderPath) {
            showToast('Folder path not found', 'error');
            return;
        }
        
        // Show delete confirmation modal
        showDeleteFolderModal(folderPath, folderName, walletAddress, currentPath);
    });
}

// Show delete file modal dialog
function showDeleteFileModal(merkleRoot: string, fileName: string, walletAddress: string, currentPath: string): void {
    // Remove any existing modal
    $('#deleteFileModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getDeleteFileModalTemplate(fileName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop (non-dismissible)
    const modalElement = document.getElementById('deleteFileModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    // Handle confirm button click
    $('#confirmDeleteFileBtn').off('click').on('click', async () => {
        await handleDeleteFile(merkleRoot, fileName, walletAddress, currentPath, modal);
    });
    
    // Handle cancel button click
    $('#cancelDeleteFileBtn').off('click').on('click', () => {
        modal.hide();
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#deleteFileModal').remove();
    });
}

// Handle delete file
async function handleDeleteFile(merkleRoot: string, fileName: string, walletAddress: string, currentPath: string, modal: any): Promise<void> {
    const $confirmBtn = $('#confirmDeleteFileBtn');
    const $cancelBtn = $('#cancelDeleteFileBtn');
    const $btnText = $('#deleteFileBtnText');
    const $spinner = $('#deleteFileSpinner');
    const $status = $('#deleteFileStatus');
    const $statusText = $('#deleteFileStatusText');
    
    try {
        // Disable buttons and show loading state
        $confirmBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Deleting...');
        $status.removeClass('d-none');
        $statusText.text('Deleting file from blockchain...');
        
        // Execute delete file transaction
        await deleteFile(merkleRoot);
        
        // Update status
        $statusText.text('File deleted successfully!');
        $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');
        
        // Show success toast
        showToast(`File "${fileName}" deleted successfully`, 'success');
        
        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
            
            // Refresh files list
            fetchFiles(walletAddress, currentPath);
        }, 1000);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Delete file failed';
        console.error('Delete file error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        showToast(`Delete failed: ${errorMessage}`, 'error');
        
        // Re-enable buttons so user can try again or cancel
        $confirmBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Delete File');
    }
}

// Show delete folder modal dialog
function showDeleteFolderModal(folderPath: string, folderName: string, walletAddress: string, currentPath: string): void {
    // Remove any existing modal
    $('#deleteFolderModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getDeleteFolderModalTemplate(folderName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop (non-dismissible)
    const modalElement = document.getElementById('deleteFolderModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    // Handle confirm button click
    $('#confirmDeleteFolderBtn').off('click').on('click', async () => {
        await handleDeleteFolder(folderPath, folderName, walletAddress, currentPath, modal);
    });
    
    // Handle cancel button click
    $('#cancelDeleteFolderBtn').off('click').on('click', () => {
        modal.hide();
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#deleteFolderModal').remove();
    });
}

// Handle delete folder
async function handleDeleteFolder(folderPath: string, folderName: string, walletAddress: string, currentPath: string, modal: any): Promise<void> {
    const $confirmBtn = $('#confirmDeleteFolderBtn');
    const $cancelBtn = $('#cancelDeleteFolderBtn');
    const $btnText = $('#deleteFolderBtnText');
    const $spinner = $('#deleteFolderSpinner');
    const $status = $('#deleteFolderStatus');
    const $statusText = $('#deleteFolderStatusText');
    
    try {
        // Disable buttons and show loading state
        $confirmBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Deleting...');
        $status.removeClass('d-none');
        $statusText.text('Deleting folder from blockchain...');
        
        // Execute delete directory transaction
        await deleteDirectory(folderPath);
        
        // Update status
        $statusText.text('Folder deleted successfully!');
        $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');
        
        // Show success toast
        showToast(`Folder "${folderName}" deleted successfully`, 'success');
        
        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
            
            // Refresh files list
            fetchFiles(walletAddress, currentPath);
        }, 1000);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Delete folder failed';
        console.error('Delete folder error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        showToast(`Delete failed: ${errorMessage}`, 'error');
        
        // Re-enable buttons so user can try again or cancel
        $confirmBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Delete Folder');
    }
}

// Show create folder modal dialog
function showCreateFolderModal(walletAddress: string, currentPath: string): void {
    // Remove any existing modal
    $('#createFolderModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getCreateFolderModalTemplate(currentPath);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal
    const modalElement = document.getElementById('createFolderModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement);
    modal.show();
    
    // Focus on input when modal is shown
    $(modalElement).on('shown.bs.modal', () => {
        $('#folderName').focus();
    });
    
    // Handle form submission
    $('#submitCreateFolderBtn').off('click').on('click', async () => {
        await handleCreateFolderSubmit(walletAddress, currentPath, modal);
    });
    
    // Handle Enter key in input field
    $('#folderName').off('keypress').on('keypress', (e: JQuery.KeyPressEvent) => {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            $('#submitCreateFolderBtn').click();
        }
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#createFolderModal').remove();
    });
}

// Handle create folder form submission
async function handleCreateFolderSubmit(walletAddress: string, currentPath: string, modal: any): Promise<void> {
    const $submitBtn = $('#submitCreateFolderBtn');
    const $btnText = $('#createFolderBtnText');
    const $spinner = $('#createFolderSpinner');
    const $folderName = $('#folderName');

    try {
        // Get folder name
        const folderName = ($folderName.val() as string).trim();

        // Validate input
        if (!folderName) {
            showToast('Folder name is required', 'error');
            return;
        }

        // Validate folder name (no slashes, no special characters that could break paths)
        if (folderName.includes('/') || folderName.includes('\\')) {
            showToast('Folder name cannot contain slashes', 'error');
            return;
        }

        // Show loading state
        $submitBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Creating...');

        // Build full path: currentPath + folderName + /
        let fullPath = currentPath;
        if (fullPath === '/') {
            fullPath = '/' + folderName + '/';
        } else {
            // currentPath already ends with /, so just append folderName
            fullPath = fullPath + folderName + '/';
        }

        console.log('Creating folder at path:', fullPath);

        // Execute create directory transaction
        const result = await createDirectory(fullPath);

        // Show success toast
        showToast('Folder created successfully!', 'success');

        // Close modal
        modal.hide();

        // Refresh files list to show the new folder
        await fetchFiles(walletAddress, currentPath);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Create folder failed';
        console.error('Create folder error:', error);
        showToast(`Create folder failed: ${errorMessage}`, 'error');
    } finally {
        $submitBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Create Folder');
    }
}

