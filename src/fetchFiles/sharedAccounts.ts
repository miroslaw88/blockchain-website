// Shared accounts functionality

import { downloadSharedFile } from '../downloadFile';
import { Dashboard } from '../dashboard/index';
import { formatDate } from '../utils';
import {
    getSharedAccountsModalTemplate,
    getEmptyStateTemplate,
    getSharedFileThumbnailTemplate,
    getFolderThumbnailTemplate,
    getEntriesGridTemplate
} from '../templates';
import { fetchWithTimeout, getFileIcon, getFolderIcon, formatFileSize, showToast } from './utils';

// Show shared accounts modal dialog
export function showSharedAccountsModal(walletAddress: string): void {
    // Remove any existing modal
    $('#sharedAccountsModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getSharedAccountsModalTemplate();
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal
    const modalElement = document.getElementById('sharedAccountsModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement);
    modal.show();
    
    // Show loading state
    $('#sharedAccountsStatus').removeClass('d-none');
    $('#sharedAccountsContent').addClass('d-none');
    $('#sharedAccountsError').addClass('d-none');
    
    // Fetch shared accounts
    fetchSharedAccounts(walletAddress);
    
    // Handle breadcrumb navigation
    $(modalElement).on('click', '.shared-breadcrumb-link', function(e) {
        e.preventDefault();
        const $link = $(this);
        const accountAddress = $link.attr('data-account');
        const path = $link.attr('data-path') || '/';
        
        if (!accountAddress) {
            // Navigate back to accounts list
            fetchSharedAccounts(walletAddress);
        } else {
            // Navigate to account path
            const indexer = Dashboard.getRandomIndexer();
            if (indexer) {
                const indexerAddress = indexer.indexer_address;
                const protocol = indexerAddress.includes('localhost') || 
                               /^\d+\.\d+\.\d+\.\d+/.test(indexerAddress) ||
                               indexerAddress.startsWith('127.0.0.1')
                    ? 'http'
                    : 'https';
                fetchSharedFiles(accountAddress, walletAddress, indexerAddress, protocol);
            }
        }
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#sharedAccountsModal').remove();
    });
}

// Fetch shared accounts from indexer
async function fetchSharedAccounts(walletAddress: string): Promise<void> {
    const $status = $('#sharedAccountsStatus');
    const $statusText = $('#sharedAccountsStatusText');
    const $content = $('#sharedAccountsContent');
    const $error = $('#sharedAccountsError');
    const $errorText = $('#sharedAccountsErrorText');
    const $breadcrumbs = $('#sharedAccountsBreadcrumbs');
    const $title = $('#sharedAccountsTitle');
    
    try {
        // Get a random active indexer
        await Dashboard.waitForIndexer();
        const indexer = Dashboard.getRandomIndexer();
        
        if (!indexer) {
            throw new Error('No active indexers available');
        }
        
        const indexerAddress = indexer.indexer_address;
        
        // Determine protocol (http or https) based on address
        const protocol = indexerAddress.includes('localhost') || 
                       /^\d+\.\d+\.\d+\.\d+/.test(indexerAddress) ||
                       indexerAddress.startsWith('127.0.0.1')
            ? 'http'
            : 'https';
        
        // Construct the URL
        const baseUrl = indexerAddress.startsWith('http://') || indexerAddress.startsWith('https://')
            ? indexerAddress
            : `${protocol}://${indexerAddress}`;
        
        const url = `${baseUrl}/api/indexer/v1/shared/accounts`;
        
        // Fetch shared accounts (POST with requester in request body)
        const response = await fetchWithTimeout(url, 15000, {
            method: 'POST',
            body: JSON.stringify({
                requester: walletAddress
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to fetch shared accounts: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        let accounts: string[] = data.accounts || [];
        
        // Add fake test account for testing
        // This account will show a test file that is not properly shared
        const fakeTestAccount = 'cosmos1testaccount123456789012345678901234567890';
        if (!accounts.includes(fakeTestAccount)) {
            accounts.push(fakeTestAccount);
        }
        
        // Display accounts as folder icons
        displaySharedAccounts(accounts, walletAddress, indexerAddress, protocol);
        
        $status.addClass('d-none');
        $content.removeClass('d-none');
        $error.addClass('d-none');
        $breadcrumbs.html('');
        $title.text('Shared Accounts');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch shared accounts';
        console.error('Fetch shared accounts error:', error);
        
        $status.addClass('d-none');
        $content.addClass('d-none');
        $errorText.text(errorMessage);
        $error.removeClass('d-none');
    }
}

// Display shared accounts as folder icons
function displaySharedAccounts(accounts: string[], requesterAddress: string, indexerAddress: string, protocol: string): void {
    const $content = $('#sharedAccountsContent');
    
    if (accounts.length === 0) {
        $content.html(getEmptyStateTemplate());
        return;
    }
    
    // Create folder thumbnails for each account (without delete button)
    const accountsGrid = accounts.map((account) => {
        // Use first 12 characters + ... for display
        const displayName = account.length > 12 ? `${account.substring(0, 12)}...` : account;
        return `
            <div class="col-md-3 col-sm-4 col-6 mb-4">
                <div class="card h-100 file-thumbnail folder-thumbnail" style="transition: transform 0.2s; cursor: pointer;" data-folder-path="${account}">
                    <div class="card-body text-center p-3">
                        <div class="file-icon mb-2" style="color: #ffc107;">
                            ${getFolderIcon()}
                        </div>
                        <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${account}">${displayName}</h6>
                        <p class="text-muted small mb-1">Account</p>
                        <div class="mt-2 d-flex gap-2 justify-content-center align-items-center">
                            <span class="badge bg-info d-flex align-items-center" style="height: 32px; padding: 0.25rem 0.5rem;">Shared Account</span>
                        </div>
                    </div>
                    <div class="card-footer bg-transparent border-0 pt-0 pb-2">
                        <small class="text-muted d-block" style="font-size: 0.75rem;">Address: ${account}</small>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    $content.html(getEntriesGridTemplate(accountsGrid));
    
    // Attach click handlers for account folders
    $('#sharedAccountsContent').off('click', '.folder-thumbnail');
    $('#sharedAccountsContent').on('click', '.folder-thumbnail', function(e) {
        // Don't navigate if clicking on the delete button
        if ($(e.target).closest('.delete-folder-btn').length > 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const $folder = $(this);
        const accountAddress = $folder.attr('data-folder-path');
        if (accountAddress) {
            fetchSharedFiles(accountAddress, requesterAddress, indexerAddress, protocol);
        }
    });
}

// Fetch shared files from a specific account
async function fetchSharedFiles(accountAddress: string, requesterAddress: string, indexerAddress: string, protocol: string): Promise<void> {
    const $status = $('#sharedAccountsStatus');
    const $statusText = $('#sharedAccountsStatusText');
    const $content = $('#sharedAccountsContent');
    const $error = $('#sharedAccountsError');
    const $errorText = $('#sharedAccountsErrorText');
    const $breadcrumbs = $('#sharedAccountsBreadcrumbs');
    const $title = $('#sharedAccountsTitle');
    
    try {
        // Show loading state
        $status.removeClass('d-none');
        $statusText.text('Loading shared files...');
        $content.addClass('d-none');
        $error.addClass('d-none');
        
        // Construct the URL
        const baseUrl = indexerAddress.startsWith('http://') || indexerAddress.startsWith('https://')
            ? indexerAddress
            : `${protocol}://${indexerAddress}`;
        
        const url = `${baseUrl}/api/indexer/v1/shared/files`;
        
        console.log('Fetching shared files from:', url);
        
        // Fetch shared files (POST with requester and sharer_account in request body)
        const response = await fetchWithTimeout(url, 15000, {
            method: 'POST',
            body: JSON.stringify({
                requester: requesterAddress,
                sharer_account: accountAddress
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to fetch shared files: ${response.status} ${errorText}`);
        }
        
        const data = await response.json();
        
        // Parse entries array - new format: { "sharer_account": "...", "entries": [{ "file": {...}, "storage_providers": [...] }] }
        let entries: Array<{
            file: {
                merkle_root: string;
                owner: string;
                path: string;
                size_bytes: number;
                expiration_time: number;
                max_proofs: number;
                metadata: string;
                uploaded_at: number;
                encrypted_file_key?: string;
            };
            storage_providers: Array<{
                provider_id?: string;
                provider_address?: string;
                providerAddress?: string;
            }>;
        }> = data.entries || [];
        
        // Add fake test file for testing download of non-shared file
        // Only add it if this is the fake test account
        // This file is NOT shared with the requester, so download should fail
        const fakeTestAccount = 'cosmos1testaccount123456789012345678901234567890';
        if (accountAddress === fakeTestAccount) {
            entries.push({
            file: {
                merkle_root: 'f8a47fcc99e096ba62e1b1f3fb3f0ca76262b72a0846f8d3096ebf0bf7926d28',
                owner: accountAddress,
                path: '/',
                size_bytes: 42939,
                expiration_time: 0,
                max_proofs: 3,
                metadata: JSON.stringify({
                    name: 'ad073ac34cc417d17b0a4dc9a46253b944e979298d9c47026d32b22db1d8b000',
                    original_name: 'Test File (Not Shared).png',
                    content_type: 'image/png',
                    original_file_hash: 'd54ede6906422c4d531f1dd9813b93feddd9c68a74ce7479495c55c85d034e3e',
                    path: ''
                }),
                uploaded_at: Math.floor(Date.now() / 1000),
                encrypted_file_key: '049049a3ce5f5e9964e958f9c9998f30a1374a06cac0741b64ce07725ed360cdeb561827031b3829cb6348c12f4d39eeff48ce65709b34068315122165028441e56c993d474f7ad52dd08f2955f10537c50af791b9e8ec27a7f4b533d07d78ec348f6ce16e30cb9fea517d574767b49ed4|04c216565ef46b477d58b32db750bb9a0ca29a00ad4e3e601a370d4e3833e635b3929b88153774898b1cd86b41499a1f97a09aa7f5b41fd274fd91c3d175544146e065dc078f7a586cd4a7528c6652cad2fad6d3688051ba5b451c45a1a1cd5d97662e5945b96bf55b57e81b699b5bc4536b3d259ae845bd3c383a1fc2d8e756b2' // Empty key - file is not shared
            },
            storage_providers: [{
                provider_id: 'provider_64e279c64ec14220',
                provider_address: 'storage.datavault.space'
            }]
            });
        }
        
        // Build breadcrumbs
        const breadcrumbs = buildSharedBreadcrumbs(accountAddress, '/');
        
        // Count files
        const fileCount = entries.length;
        
        // Update title
        const displayAccount = accountAddress.length > 20 ? `${accountAddress.substring(0, 20)}...` : accountAddress;
        $title.text(`Shared Files: ${displayAccount}`);
        
        // Update breadcrumbs
        $breadcrumbs.html(breadcrumbs);
        
        // Display entries
        if (entries.length === 0) {
            $content.html(getEmptyStateTemplate());
        } else {
            const entriesGrid = entries.map((entry: any) => {
                const file = entry.file;
                
                // Parse metadata (it's a JSON string)
                let metadata: any = { content_type: 'application/octet-stream' };
                try {
                    metadata = JSON.parse(file.metadata || '{}');
                } catch (e) {
                    console.warn('Failed to parse metadata:', e);
                }
                
                const fileName = metadata.original_name || 'Unknown File';
                const contentType = metadata.content_type || 'application/octet-stream';
                const sizeBytes = typeof file.size_bytes === 'number' ? file.size_bytes : parseInt(file.size_bytes?.toString() || '0', 10);
                const fileSize = formatFileSize(sizeBytes);
                const uploadTimestamp = typeof file.uploaded_at === 'number' ? file.uploaded_at : parseInt(file.uploaded_at?.toString() || '0', 10);
                const uploadDate = formatDate(uploadTimestamp);
                const expirationTimestamp = typeof file.expiration_time === 'number' ? file.expiration_time : parseInt(file.expiration_time?.toString() || '0', 10);
                const expirationDate = formatDate(expirationTimestamp);
                const isExpired = Boolean(expirationTimestamp && expirationTimestamp < Math.floor(Date.now() / 1000));
                const merkleRoot = file.merkle_root || '';
                const storageProviders = entry.storage_providers || [];
                
                // Get encrypted file key from entry
                // The indexer returns encrypted_file_key (singular) in the file object
                // This is the key encrypted with the recipient's public key
                const encryptedFileKey = file.encrypted_file_key || file.encryptedFileKey || '';
                
                // Debug: Log the encrypted file key from the response
                console.log('Extracting encrypted file key from entry:', {
                    hasEncryptedFileKey: !!encryptedFileKey,
                    encryptedFileKeyLength: encryptedFileKey.length,
                    encryptedFileKeyPreview: encryptedFileKey.substring(0, 30) + '...',
                    fileKeys: Object.keys(file)
                });
                
                // Store storage providers, metadata, and encrypted file key in data attributes for download
                // Use HTML entity encoding for the encrypted key to avoid issues with special characters
                const escapedEncryptedKey = encryptedFileKey.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                
                return getSharedFileThumbnailTemplate(
                    fileName,
                    fileSize,
                    uploadDate,
                    expirationDate,
                    merkleRoot,
                    contentType,
                    isExpired,
                    getFileIcon(contentType)
                ).replace(
                    'data-merkle-root="' + merkleRoot + '"',
                    `data-merkle-root="${merkleRoot}" data-storage-providers='${JSON.stringify(storageProviders)}' data-file-metadata='${JSON.stringify(metadata)}' data-encrypted-file-key="${escapedEncryptedKey}"`
                );
            }).filter(html => html !== '').join('');
            
            $content.html(getEntriesGridTemplate(entriesGrid));
            
            // Attach event handlers for files (download)
            $('#sharedAccountsContent').off('click', '.download-shared-btn');
            $('#sharedAccountsContent').on('click', '.download-shared-btn', async function(e) {
                e.preventDefault();
                const $button = $(this);
                const merkleRoot = $button.attr('data-merkle-root');
                const storageProvidersStr = $button.attr('data-storage-providers') || '[]';
                const fileMetadataStr = $button.attr('data-file-metadata') || '{}';
                const encryptedFileKey = $button.attr('data-encrypted-file-key') || '';
                
                // Debug: Log all extracted data
                console.log('=== Download Shared File - Extracted Data ===');
                console.log('Merkle Root:', merkleRoot);
                console.log('Storage Providers (raw):', storageProvidersStr);
                console.log('File Metadata (raw):', fileMetadataStr);
                console.log('Encrypted File Key (raw):', encryptedFileKey);
                console.log('Encrypted File Key length:', encryptedFileKey.length);
                console.log('Requester Address:', requesterAddress);
                
                if (!merkleRoot) {
                    showToast('File identifier not found', 'error');
                    return;
                }
                
                if (!encryptedFileKey) {
                    console.error('Encrypted file key is empty or missing');
                    showToast('Encrypted file key not found. File may not be properly shared.', 'error');
                    return;
                }
                
                let storageProviders: Array<{ provider_id?: string; provider_address?: string; providerAddress?: string }> = [];
                let fileMetadata: any = {};
                
                try {
                    storageProviders = JSON.parse(storageProvidersStr);
                    fileMetadata = JSON.parse(fileMetadataStr);
                    
                    // Debug: Log parsed data
                    console.log('Storage Providers (parsed):', storageProviders);
                    console.log('File Metadata (parsed):', fileMetadata);
                    console.log('Encrypted File Key (preview):', encryptedFileKey.substring(0, 50) + '...');
                } catch (e) {
                    console.error('Failed to parse storage providers or metadata:', e);
                    showToast('Failed to parse file data', 'error');
                    return;
                }
                
                const $buttonContainer = $button.parent();
                const originalHTML = $buttonContainer.html();
                
                try {
                    await downloadSharedFile(merkleRoot, storageProviders, fileMetadata, encryptedFileKey, requesterAddress, $button);
                } finally {
                    $buttonContainer.html(originalHTML);
                }
            });
        }
        
        $status.addClass('d-none');
        $content.removeClass('d-none');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch shared files';
        console.error('Fetch shared files error:', error);
        
        $status.addClass('d-none');
        $content.addClass('d-none');
        $errorText.text(errorMessage);
        $error.removeClass('d-none');
    }
}

// Build breadcrumbs for shared files navigation
function buildSharedBreadcrumbs(accountAddress: string, currentPath: string): string {
    const segments: Array<{ name: string; path: string }> = [
        { name: 'Shared Accounts', path: '' }
    ];
    
    if (currentPath && currentPath !== '/') {
        const pathSegments = currentPath.split('/').filter(seg => seg !== '');
        let accumulatedPath = '';
        
        pathSegments.forEach((segment, index) => {
            accumulatedPath += '/' + segment;
            segments.push({
                name: segment,
                path: accumulatedPath + (index < pathSegments.length - 1 ? '/' : '')
            });
        });
    } else {
        segments.push({ name: accountAddress.substring(0, 12) + '...', path: '/' });
    }
    
    let breadcrumbItems = '';
    segments.forEach((segment, index) => {
        const isLast = index === segments.length - 1;
        if (isLast) {
            breadcrumbItems += `<li class="breadcrumb-item active" aria-current="page">${segment.name}</li>`;
        } else {
            breadcrumbItems += `<li class="breadcrumb-item"><a href="#" class="shared-breadcrumb-link" data-account="${accountAddress}" data-path="${segment.path}">${segment.name}</a></li>`;
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

