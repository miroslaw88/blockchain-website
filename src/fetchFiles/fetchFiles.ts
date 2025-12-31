// Main file fetching functionality

import { downloadFile } from '../downloadFile';
import { Dashboard } from '../dashboard/index';
import { formatDate } from '../utils';
import {
    getFilesViewTemplate,
    getEmptyStateTemplate,
    getFileThumbnailTemplate,
    getFolderThumbnailTemplate,
    getEntriesGridTemplate,
    getErrorTemplate,
    getLoadingTemplate
} from '../templates';
import { fetchWithTimeout, getFileIcon, getFolderIcon, formatFileSize, buildBreadcrumbs, showToast } from './utils';
import { showDeleteFileModal, showDeleteFolderModal } from './deleteOperations';
import { showShareFileModal } from './shareFileOperations';
import { showSharedAccountsModal } from './sharedAccounts';
import { showCreateFolderModal } from './createFolder';
import { showVideoPlayerModal } from './videoPlayer';

// Fetch files from blockchain
// path: Optional path to navigate into a specific folder (e.g., "/test/")
export async function fetchFiles(walletAddress: string, path: string = ''): Promise<void> {
    const $contentArea = $('#contentArea');
    if ($contentArea.length === 0) return;

    // Show loading state
    $contentArea.html(getLoadingTemplate());

    try {
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
        
        // Wait for an indexer to become available
        const indexer = await Dashboard.waitForIndexer();
        
        // Use indexer endpoint: POST /api/indexer/v1/files/dir
        const protocol = indexer.indexer_address.includes('localhost') || 
                       /^\d+\.\d+\.\d+\.\d+/.test(indexer.indexer_address) ||
                       indexer.indexer_address.startsWith('127.0.0.1')
            ? 'http'
            : 'https';
        const baseUrl = indexer.indexer_address.startsWith('http://') || indexer.indexer_address.startsWith('https://')
            ? indexer.indexer_address
            : `${protocol}://${indexer.indexer_address}`;
        const apiUrl = `${baseUrl}/api/indexer/v1/files/dir`;
        
        console.log('Fetching from indexer:', apiUrl);
        console.log('Path parameter:', normalizedPath);
        
        // Fetch data with 15 second timeout (POST with owner, path, and requester in body)
        const response = await fetchWithTimeout(apiUrl, 15000, {
            method: 'POST',
            body: JSON.stringify({
                owner: walletAddress,
                path: normalizedPath,
                requester: walletAddress
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            const errorJson = JSON.parse(errorText);
            
            let errorMessage: string;
            if (errorJson.code === 12 || response.status === 501) {
                errorMessage = `Not Implemented (code 12): The endpoint may not be implemented or Caddy is not routing correctly.`;
                errorMessage += `\n\nTried: ${apiUrl}`;
                errorMessage += `\n\nCheck:`;
                errorMessage += `\n1. Caddyfile has route: handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }`;
                errorMessage += `\n2. Test directly: curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}`;
                errorMessage += `\n3. Verify blockchain API server implements this endpoint`;
            } else {
                errorMessage = `HTTP error! status: ${response.status}, code: ${errorJson.code}, message: ${errorJson.message || errorText}`;
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
            extra_data?: string;
            extraData?: string;
            encrypted_file_key?: string;
            chunk_count?: number;
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
            $contentArea.off('click', '#sharedToolbarBtn');
            $contentArea.on('click', '#sharedToolbarBtn', function(e) {
                e.preventDefault();
                showSharedAccountsModal(walletAddress);
            });
            
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
                const sizeBytes = parseInt(entry.size_bytes || '0', 10);
                const fileSize = formatFileSize(sizeBytes);
                const uploadDate = formatDate(parseInt(entry.uploaded_at || '0', 10));
                const expirationDate = formatDate(parseInt(entry.expiration_time || '0', 10));
                const expirationTimestamp = parseInt(entry.expiration_time || '0', 10);
                const isExpired = Boolean(expirationTimestamp && expirationTimestamp < Math.floor(Date.now() / 1000));
                const merkleRoot = entry.merkle_root || '';
                // Get encrypted file key from indexer response
                const encryptedFileKey = entry.encrypted_file_key || '';
                // Get chunk_count from indexer response
                const chunkCount = entry.chunk_count || 1;
                // Get extraData from indexer response (e.g., MPEG-DASH manifest)
                // Support both snake_case (from API) and camelCase
                const extraDataRaw = entry.extra_data || entry.extraData || '';
                // Decode Unicode escape sequences and HTML entities
                // The API may return Unicode escapes like \u003c (<) and \u003e (>)
                let extraData = extraDataRaw;
                if (extraDataRaw) {
                    // Try to decode as JSON string first (handles all Unicode escapes)
                    try {
                        extraData = JSON.parse(`"${extraDataRaw.replace(/"/g, '\\"')}"`);
                    } catch (e) {
                        // If JSON parsing fails, manually decode common escapes
                        extraData = extraDataRaw
                            .replace(/\\u003c/g, '<')
                            .replace(/\\u003e/g, '>')
                            .replace(/\\u0026/g, '&')
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\'/g, "'");
                    }
                }
                
                // Generate thumbnail HTML and add encrypted_file_key as data attribute
                const thumbnailHTML = getFileThumbnailTemplate(
                    fileName,
                    fileSize,
                    uploadDate,
                    expirationDate,
                    merkleRoot,
                    contentType,
                    isExpired,
                    getFileIcon(contentType),
                    extraData || undefined,
                    chunkCount
                );
                
                // Add encrypted_file_key to all buttons' data attributes (download, share, delete)
                if (encryptedFileKey) {
                    // Replace all instances of data-merkle-root to add encrypted_file_key
                    return thumbnailHTML.replace(
                        /data-merkle-root="([^"]+)"/g,
                        `data-merkle-root="$1" data-encrypted-file-key="${encryptedFileKey}"`
                    );
                }
                
                return thumbnailHTML;
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
        const encryptedFileKey = $button.attr('data-encrypted-file-key') || '';
        
        if (!merkleRoot) {
            showToast('File identifier not found', 'error');
            return;
        }
        
        if (!encryptedFileKey) {
            showToast('Encrypted file key not found', 'error');
            return;
        }
        
        // Show download progress toast immediately when button is clicked (before any API calls)
        const { showDownloadProgressToast, finalizeDownloadProgress } = await import('../downloadFile');
        showDownloadProgressToast(merkleRoot, fileName);
        
        // Create file metadata object with encrypted file key from indexer
        const fileMetadata = {
            merkleRoot: merkleRoot,
            merkle_root: merkleRoot,
            encryptedFileKey: encryptedFileKey,
            encrypted_file_key: encryptedFileKey
        };
        
        try {
            await downloadFile(fileMetadata, walletAddress, $button);
            // Finalize toast on success
            finalizeDownloadProgress(merkleRoot, true);
        } catch (error) {
            // Finalize toast on error
            finalizeDownloadProgress(merkleRoot, false);
            throw error;
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
    
    // Add click handler for play video buttons
    $contentArea.off('click', '.play-video-btn');
    $contentArea.on('click', '.play-video-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $button = $(this);
        const merkleRoot = $button.attr('data-merkle-root');
        const fileName = $button.attr('data-file-name') || 'file';
        
        if (!merkleRoot) {
            showToast('File identifier not found', 'error');
            return;
        }
        
        // Get extra_data (MPEG-DASH manifest) and chunk_count from the thumbnail card
        const $thumbnail = $button.closest('.file-thumbnail');
        const extraData = $thumbnail.attr('data-extra-data');
        const chunkCountAttr = $thumbnail.attr('data-chunk-count');
        const chunkCount = chunkCountAttr ? parseInt(chunkCountAttr, 10) : undefined;
        
        if (!extraData) {
            showToast('Video manifest not found', 'error');
            return;
        }
        
        // Decode HTML entities and Unicode escape sequences
        const decodedExtraData = extraData
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#10;/g, '\n')
            .replace(/\\u003c/g, '<')
            .replace(/\\u003e/g, '>')
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"');
        
        // Show video player modal
        showVideoPlayerModal(merkleRoot, fileName, decodedExtraData, chunkCount);
    });
    
    // Add click handler for share file buttons
    $contentArea.off('click', '.share-file-btn');
    $contentArea.on('click', '.share-file-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $button = $(this);
        const merkleRoot = $button.attr('data-merkle-root');
        const fileName = $button.attr('data-file-name') || 'file';
        const encryptedFileKey = $button.attr('data-encrypted-file-key') || '';
        
        if (!merkleRoot) {
            showToast('File identifier not found', 'error');
            return;
        }
        
        if (!encryptedFileKey) {
            showToast('Encrypted file key not found', 'error');
            return;
        }
        
        // Show share file modal with file's encrypted AES bundle
        showShareFileModal(merkleRoot, fileName, walletAddress, encryptedFileKey);
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
    
    // Add click handler for share folder buttons
    $contentArea.off('click', '.share-folder-btn');
    $contentArea.on('click', '.share-folder-btn', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $button = $(this);
        const folderPath = $button.attr('data-folder-path');
        const folderName = $button.attr('data-folder-name') || 'folder';
        
        if (!folderPath) {
            showToast('Folder path not found', 'error');
            return;
        }
        
        // Show share folder modal
        const { showShareFolderModal } = await import('./shareFolderOperations');
        showShareFolderModal(folderPath, folderName, walletAddress);
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

