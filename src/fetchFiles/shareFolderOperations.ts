// Share folder operations

import { shareFolder } from '../shareFolder';
import { getShareResourceModalTemplate } from '../templates';
import { showToast } from './utils';
import { encryptFileKeyWithECIES } from '../osd-blockchain-sdk';
import { hasAccountKey } from '../accountKey';
import { Dashboard } from '../dashboard/index';
import { fetchWithTimeout } from './utils';

// Show share folder modal dialog
export function showShareFolderModal(folderPath: string, folderName: string, walletAddress: string): void {
    // Remove any existing modal
    $('#shareResourceModal').remove();
    
    // Create modal HTML using template (resourceType: 'folder')
    const modalHTML = getShareResourceModalTemplate('folder', folderName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop (non-dismissible)
    const modalElement = document.getElementById('shareResourceModal');
    if (!modalElement) return;
    
    // Store folderPath in modal element's data attribute
    $(modalElement).attr('data-folder-path', folderPath);
    $(modalElement).attr('data-resource-type', 'folder');
    
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    // Set default expiration date (30 days from now) and focus on input when modal is shown
    $(modalElement).on('shown.bs.modal', async () => {
        // Set default expiration to 30 days from now
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() + 30);
        
        // Format as datetime-local value (YYYY-MM-DDTHH:mm)
        const year = defaultDate.getFullYear();
        const month = String(defaultDate.getMonth() + 1).padStart(2, '0');
        const day = String(defaultDate.getDate()).padStart(2, '0');
        const hours = String(defaultDate.getHours()).padStart(2, '0');
        const minutes = String(defaultDate.getMinutes()).padStart(2, '0');
        const defaultValue = `${year}-${month}-${day}T${hours}:${minutes}`;
        
        $('#shareExpiresAt').val(defaultValue);
        $('#shareAddress').focus();
        
        // Fetch and display current share info
        await fetchAndDisplayFolderShareInfo(folderPath, walletAddress);
    });
    
    // Handle confirm button click
    $('#confirmShareResourceBtn').off('click').on('click', async () => {
        await handleShareFolderSubmit(folderPath, folderName, walletAddress, modal);
    });
    
    // Handle cancel button click
    $('#cancelShareResourceBtn').off('click').on('click', () => {
        modal.hide();
    });
    
    // Handle Enter key in input fields
    $('#shareResourceForm input').off('keypress').on('keypress', (e: JQuery.KeyPressEvent) => {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            $('#confirmShareResourceBtn').click();
        }
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#shareResourceModal').remove();
    });
}

// Handle share folder form submission
async function handleShareFolderSubmit(folderPath: string, folderName: string, walletAddress: string, modal: any): Promise<void> {
    const $confirmBtn = $('#confirmShareResourceBtn');
    const $cancelBtn = $('#cancelShareResourceBtn');
    const $btnText = $('#shareResourceBtnText');
    const $spinner = $('#shareResourceSpinner');
    const $status = $('#shareResourceStatus');
    const $statusText = $('#shareResourceStatusText');
    
    try {
        // Get form values
        const shareAddress = ($('#shareAddress').val() as string).trim();
        const expiresAtDateTime = ($('#shareExpiresAt').val() as string).trim();
        
        // Validate inputs
        if (!shareAddress) {
            showToast('Wallet address is required', 'error');
            return;
        }
        
        // Basic validation for Cosmos address format (starts with cosmos1)
        if (!shareAddress.startsWith('cosmos1')) {
            showToast('Invalid wallet address format. Must start with "cosmos1"', 'error');
            return;
        }
        
        if (!expiresAtDateTime) {
            showToast('Expiration date and time is required', 'error');
            return;
        }
        
        // Convert datetime-local value to Unix timestamp (seconds since epoch)
        const selectedDate = new Date(expiresAtDateTime);
        
        // Check if the date is valid
        if (isNaN(selectedDate.getTime())) {
            showToast('Invalid expiration date and time', 'error');
            return;
        }
        
        // Convert to Unix timestamp (seconds since epoch)
        const expiresAt = Math.floor(selectedDate.getTime() / 1000);
        
        // Check if expiration is in the future
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (expiresAt <= currentTimestamp) {
            showToast('Expiration date and time must be in the future', 'error');
            return;
        }
        
        // Disable buttons and show loading state
        $confirmBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Sharing...');
        $status.removeClass('d-none');
        $statusText.text('Verifying recipient has account key...');
        
        // Step 0: Verify recipient has an account key on blockchain
        const recipientHasKey = await hasAccountKey(shareAddress);
        if (!recipientHasKey) {
            throw new Error(`Recipient ${shareAddress} does not have an account key. They must generate a symmetric key first.`);
        }
        
        // Step 1: Get folder access key (for folders, we use the owner's account key as the folder access key)
        // In a real implementation, folders might have their own access keys, but for now we'll use the account key
        $statusText.text('Getting folder access key...');
        const { getAccountKey } = await import('../accountKey');
        const folderAccessKey = await getAccountKey(walletAddress);
        
        // Step 2: Encrypt folder access key with recipient's public key using ECIES
        $statusText.text('Encrypting folder access key for recipient...');
        const { aesToString } = await import('../osd-blockchain-sdk');
        const { getAccountPublicKey } = await import('../osd-blockchain-sdk');
        const recipientPublicKey = await getAccountPublicKey(shareAddress);
        
        // Convert folder access key to AES bundle format (32 bytes key + 16 bytes IV)
        // For folders, we'll use the account key as the key and generate a random IV
        const iv = crypto.getRandomValues(new Uint8Array(16));
        const keyBytes = new Uint8Array(folderAccessKey);
        
        // Create AES bundle
        const folderAesBundle = {
            iv: iv,
            key: await crypto.subtle.importKey(
                'raw',
                keyBytes,
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            )
        };
        
        // Encrypt the AES bundle with recipient's public key
        const recipientEncryptedKey = await aesToString(recipientPublicKey, folderAesBundle);
        
        // Debug: Verify encrypted key was created
        console.log('Encrypted folder access key for recipient:', {
            recipient: shareAddress,
            encryptedKeyLength: recipientEncryptedKey.length,
            encryptedKeyPreview: recipientEncryptedKey.substring(0, 20) + '...'
        });
        
        // Step 3: Share folder with encrypted access key
        $statusText.text('Sharing folder with indexers...');
        const encryptedFileKeys: { [recipient: string]: string } = {
            [shareAddress]: recipientEncryptedKey
        };
        
        const result = await shareFolder(folderPath, walletAddress, [shareAddress], expiresAt, encryptedFileKeys);
        
        // Update status based on results
        if (result.failureCount === 0) {
            $statusText.text(`Folder shared successfully with ${result.successCount} indexer(s)!`);
            $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');
            showToast(`Folder "${folderName}" shared successfully`, 'success');
        } else if (result.successCount > 0) {
            $statusText.text(`Partially successful: ${result.successCount} succeeded, ${result.failureCount} failed`);
            $status.removeClass('d-none alert-info alert-success').addClass('alert-warning');
            showToast(`Folder shared with ${result.successCount} indexer(s), ${result.failureCount} failed`, 'info');
        } else {
            throw new Error(`Failed to share with all indexers. ${result.failedIndexers.map(f => f.error).join('; ')}`);
        }
        
        // Refresh share info after successful share
        await fetchAndDisplayFolderShareInfo(folderPath, walletAddress);
        
        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
        }, 2000);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Share folder failed';
        console.error('Share folder error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        showToast(`Share failed: ${errorMessage}`, 'error');
        
        // Re-enable buttons so user can try again or cancel
        $confirmBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Share Folder');
    }
}

// Fetch and display current share info for a folder
async function fetchAndDisplayFolderShareInfo(folderPath: string, owner: string): Promise<void> {
    const $sharedWithList = $('#sharedWithList');
    
    // Store folderPath and owner in data attributes for revoke handler
    $sharedWithList.attr('data-folder-path', folderPath);
    $sharedWithList.attr('data-owner', owner);
    $sharedWithList.attr('data-resource-type', 'folder');
    
    try {
        // Get a random active indexer
        await Dashboard.waitForIndexer();
        const indexer = Dashboard.getRandomIndexer();
        
        if (!indexer) {
            $sharedWithList.html('<div class="text-muted small text-center py-2">No indexers available</div>');
            return;
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
        
        const encodedPath = encodeURIComponent(folderPath);
        const url = `${baseUrl}/api/indexer/v1/directories/${encodedPath}/share?owner=${encodeURIComponent(owner)}`;
        
        // Fetch share info
        const response = await fetchWithTimeout(url, 10000);
        
        if (!response.ok) {
            if (response.status === 404) {
                // Folder is not shared with anyone
                $sharedWithList.html('<div class="text-muted small text-center py-2">This folder is not currently shared with anyone</div>');
                return;
            }
            throw new Error(`Failed to fetch share info: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const sharedWith: string[] = data.shared_with || [];
        
        // Display shared accounts with Remove buttons
        if (sharedWith.length === 0) {
            $sharedWithList.html('<div class="text-muted small text-center py-2">This folder is not currently shared with anyone</div>');
        } else {
            const accountsList = sharedWith.map((address: string) => {
                const displayAddress = address.length > 30 ? `${address.substring(0, 30)}...` : address;
                return `
                    <div class="mb-1 p-2 bg-white rounded border d-flex justify-content-between align-items-center" style="font-family: monospace; font-size: 0.85rem;">
                        <span class="flex-grow-1 text-truncate" title="${address}">${displayAddress}</span>
                        <button class="btn btn-sm btn-outline-danger revoke-share-btn ms-2" data-account="${address}" title="Remove access">
                            Remove
                        </button>
                    </div>
                `;
            }).join('');
            $sharedWithList.html(accountsList);
            
            // Attach event handlers for revoke buttons
            $sharedWithList.off('click', '.revoke-share-btn');
            $sharedWithList.on('click', '.revoke-share-btn', (function(folderPathValue: string, ownerValue: string) {
                return async function(e: JQuery.Event) {
                    e.preventDefault();
                    e.stopPropagation();
                    const $button = $(this);
                    const accountToRevoke = $button.attr('data-account');
                    if (accountToRevoke) {
                        await handleRevokeFolderShare(folderPathValue, ownerValue, accountToRevoke);
                    }
                };
            })(folderPath, owner));
        }
    } catch (error) {
        console.error('Error fetching folder share info:', error);
        $sharedWithList.html('<div class="text-danger small text-center py-2">Error loading share information</div>');
    }
}

// Handle revoking share access for a specific account
async function handleRevokeFolderShare(folderPath: string, owner: string, accountToRevoke: string): Promise<void> {
    const $sharedWithList = $('#sharedWithList');
    const $button = $(`.revoke-share-btn[data-account="${accountToRevoke}"]`);
    
    // Disable button and show loading state
    const originalText = $button.text();
    $button.prop('disabled', true);
    $button.html('<span class="spinner-border spinner-border-sm" role="status"></span>');
    
    try {
        // Get all active indexers
        const activeIndexers = Dashboard.getAllActiveIndexers();
        
        if (activeIndexers.length === 0) {
            throw new Error('No active indexers available. Please wait and try again.');
        }
        
        // Prepare the payload
        const payload = {
            account_to_revoke: accountToRevoke
        };
        
        // Send revoke request to all active indexers
        const results = await Promise.allSettled(
            activeIndexers.map(async (indexer) => {
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
                
                const encodedPath = encodeURIComponent(folderPath);
                const url = `${baseUrl}/api/indexer/v1/directories/${encodedPath}/share/revoke?owner=${encodeURIComponent(owner)}`;
                
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Indexer ${indexerAddress} returned ${response.status}: ${errorText}`);
                    }
                    
                    return { indexer: indexerAddress, success: true };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    throw { indexer: indexerAddress, error: errorMessage };
                }
            })
        );
        
        // Process results
        const successfulIndexers: string[] = [];
        const failedIndexers: Array<{ indexer: string; error: string }> = [];
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successfulIndexers.push(result.value.indexer);
            } else {
                const rejectionValue = result.reason;
                if (rejectionValue && typeof rejectionValue === 'object' && 'indexer' in rejectionValue) {
                    failedIndexers.push({
                        indexer: rejectionValue.indexer,
                        error: rejectionValue.error || 'Unknown error'
                    });
                } else {
                    failedIndexers.push({
                        indexer: activeIndexers[index]?.indexer_address || 'unknown',
                        error: rejectionValue?.message || rejectionValue?.toString() || 'Unknown error'
                    });
                }
            }
        });
        
        if (failedIndexers.length === 0) {
            showToast(`Access revoked successfully for ${accountToRevoke.substring(0, 12)}...`, 'success');
            await fetchAndDisplayFolderShareInfo(folderPath, owner);
        } else if (successfulIndexers.length > 0) {
            showToast(`Access revoked on ${successfulIndexers.length} indexer(s), ${failedIndexers.length} failed`, 'info');
            await fetchAndDisplayFolderShareInfo(folderPath, owner);
        } else {
            throw new Error(`Failed to revoke access on all indexers. ${failedIndexers.map(f => f.error).join('; ')}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to revoke access';
        console.error('Revoke folder share error:', error);
        showToast(`Failed to revoke access: ${errorMessage}`, 'error');
        
        // Re-enable button
        $button.prop('disabled', false);
        $button.text(originalText);
    }
}

