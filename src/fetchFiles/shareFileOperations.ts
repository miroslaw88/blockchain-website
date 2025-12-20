// Share file operations

import { shareFile } from '../shareFile';
import { getShareResourceModalTemplate } from '../templates';
import { showToast } from './utils';
import { encryptFileKeyWithECIES } from '../osd-blockchain-sdk';
import { hasAccountKey } from '../accountKey';
import { Dashboard } from '../dashboard/index';
import { fetchWithTimeout } from './utils';

// Show share file modal dialog
// encryptedFileKey: The file's AES bundle encrypted with owner's public key (base64 string)
export function showShareFileModal(merkleRoot: string, fileName: string, walletAddress: string, encryptedFileKey?: string): void {
    // Remove any existing modal
    $('#shareResourceModal').remove();
    
    // Create modal HTML using generic template (resourceType: 'file')
    const modalHTML = getShareResourceModalTemplate('file', fileName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop (non-dismissible)
    const modalElement = document.getElementById('shareResourceModal');
    if (!modalElement) return;
    
    // Store encryptedFileKey and merkleRoot in modal element's data attributes
    if (encryptedFileKey) {
        $(modalElement).attr('data-encrypted-file-key', encryptedFileKey);
    }
    $(modalElement).attr('data-merkle-root', merkleRoot);
    $(modalElement).attr('data-resource-type', 'file');
    
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
        await fetchAndDisplayShareInfo(merkleRoot, walletAddress);
    });
    
    // Handle confirm button click
    $('#confirmShareResourceBtn').off('click').on('click', async () => {
        const storedEncryptedKey = $(modalElement).attr('data-encrypted-file-key') || encryptedFileKey;
        await handleShareFileSubmit(merkleRoot, fileName, walletAddress, modal, storedEncryptedKey);
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

// Handle share file form submission
async function handleShareFileSubmit(merkleRoot: string, fileName: string, walletAddress: string, modal: any, encryptedFileKey?: string): Promise<void> {
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
        // datetime-local returns format: "YYYY-MM-DDTHH:mm" in local time
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
        // Uses the same method as checkAndUpdateAccountKeyStatus() - queries blockchain endpoint:
        // GET /osd-blockchain/osdblockchain/v1/account/{shareAddress}/key
        // This is the ONLY way we check for account keys - no indexer queries
        const recipientHasKey = await hasAccountKey(shareAddress);
        if (!recipientHasKey) {
            throw new Error(`Recipient ${shareAddress} does not have an account key. They must generate a symmetric key first.`);
        }
        
        // Step 1: Get file's AES bundle from encrypted_file_key
        // The encryptedFileKey is the file's AES bundle encrypted with owner's public key
        if (!encryptedFileKey) {
            throw new Error('File encryption key not found. Cannot share file without encryption key.');
        }
        
        $statusText.text('Decrypting file encryption key...');
        const { decryptFileKeyWithECIES } = await import('../osd-blockchain-sdk');
        const fileAesBundle = await decryptFileKeyWithECIES(encryptedFileKey, walletAddress);
        
        // Step 2: Encrypt file's AES bundle with recipient's public key using ECIES
        // getAccountPublicKey() queries blockchain: GET /osd-blockchain/osdblockchain/v1/account/{shareAddress}/key
        // No indexer queries - all data comes from blockchain
        $statusText.text('Encrypting file key for recipient...');
        const recipientEncryptedKeyBase64 = await encryptFileKeyWithECIES(fileAesBundle, shareAddress);
        
        // Debug: Verify encrypted key was created
        console.log('Encrypted key for recipient:', {
            recipient: shareAddress,
            encryptedKeyLength: recipientEncryptedKeyBase64.length,
            encryptedKeyPreview: recipientEncryptedKeyBase64.substring(0, 20) + '...'
        });
        
        // Step 3: Share file with re-encrypted account key
        $statusText.text('Sharing file with indexers...');
        const result = await shareFile(merkleRoot, walletAddress, [shareAddress], expiresAt, recipientEncryptedKeyBase64);
        
        // Update status based on results
        if (result.failureCount === 0) {
            $statusText.text(`File shared successfully with ${result.successCount} indexer(s)!`);
            $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');
            showToast(`File "${fileName}" shared successfully`, 'success');
        } else if (result.successCount > 0) {
            $statusText.text(`Partially successful: ${result.successCount} succeeded, ${result.failureCount} failed`);
            $status.removeClass('d-none alert-info alert-success').addClass('alert-warning');
            showToast(`File shared with ${result.successCount} indexer(s), ${result.failureCount} failed`, 'info');
        } else {
            throw new Error(`Failed to share with all indexers. ${result.failedIndexers.map(f => f.error).join('; ')}`);
        }
        
        // Refresh share info after successful share
        await fetchAndDisplayShareInfo(merkleRoot, walletAddress);
        
        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
        }, 2000);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Share file failed';
        console.error('Share file error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        showToast(`Share failed: ${errorMessage}`, 'error');
        
        // Re-enable buttons so user can try again or cancel
        $confirmBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Share File');
    }
}

// Fetch and display current share info for a file
async function fetchAndDisplayShareInfo(merkleRoot: string, owner: string): Promise<void> {
    const $sharedWithList = $('#sharedWithList');
    
    // Store merkleRoot and owner in data attributes for revoke handler
    $sharedWithList.attr('data-merkle-root', merkleRoot);
    $sharedWithList.attr('data-owner', owner);
    $sharedWithList.attr('data-resource-type', 'file');
    
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
        
        const url = `${baseUrl}/api/indexer/v1/files/share/info`;
        
        // Fetch share info (POST with owner and merkle_root in request body)
        const response = await fetchWithTimeout(url, 10000, {
            method: 'POST',
            body: JSON.stringify({ 
                owner: owner,
                merkle_root: merkleRoot
            })
            // Note: Not setting Content-Type header to avoid CORS preflight
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                // File is not shared with anyone
                $sharedWithList.html('<div class="text-muted small text-center py-2">This file is not currently shared with anyone</div>');
                return;
            }
            throw new Error(`Failed to fetch share info: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const sharedWith: string[] = data.shared_with || [];
        
        // Display shared accounts with Remove buttons
        if (sharedWith.length === 0) {
            $sharedWithList.html('<div class="text-muted small text-center py-2">This file is not currently shared with anyone</div>');
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
            // Use closure to capture merkleRoot and owner
            $sharedWithList.off('click', '.revoke-share-btn');
            $sharedWithList.on('click', '.revoke-share-btn', (function(merkleRootValue: string, ownerValue: string) {
                return async function(e: JQuery.Event) {
                    e.preventDefault();
                    e.stopPropagation();
                    const $button = $(this);
                    const accountToRevoke = $button.attr('data-account');
                    if (accountToRevoke) {
                        await handleRevokeShare(merkleRootValue, ownerValue, accountToRevoke);
                    }
                };
            })(merkleRoot, owner));
        }
    } catch (error) {
        console.error('Error fetching share info:', error);
        $sharedWithList.html('<div class="text-danger small text-center py-2">Error loading share information</div>');
    }
}

// Handle revoking share access for a specific account
async function handleRevokeShare(merkleRoot: string, owner: string, accountToRevoke: string): Promise<void> {
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
                
                const url = `${baseUrl}/api/indexer/v1/files/share/revoke`;
                
                // Prepare payload with owner, merkle_root, and account_to_revoke
                const fullPayload = {
                    owner: owner,
                    merkle_root: merkleRoot,
                    account_to_revoke: accountToRevoke
                };
                
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        body: JSON.stringify(fullPayload)
                        // Note: Not setting Content-Type header to avoid CORS preflight
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
            // All indexers succeeded
            showToast(`Access revoked successfully for ${accountToRevoke.substring(0, 12)}...`, 'success');
            // Refresh the share info list
            await fetchAndDisplayShareInfo(merkleRoot, owner);
        } else if (successfulIndexers.length > 0) {
            // Partially successful
            showToast(`Access revoked on ${successfulIndexers.length} indexer(s), ${failedIndexers.length} failed`, 'info');
            // Refresh the share info list anyway
            await fetchAndDisplayShareInfo(merkleRoot, owner);
        } else {
            // All failed
            throw new Error(`Failed to revoke access on all indexers. ${failedIndexers.map(f => f.error).join('; ')}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to revoke access';
        console.error('Revoke share error:', error);
        showToast(`Failed to revoke access: ${errorMessage}`, 'error');
        
        // Re-enable button
        $button.prop('disabled', false);
        $button.text(originalText);
    }
}

