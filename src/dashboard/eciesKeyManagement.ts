// ECIES key management functionality

import { hasAccountKey } from '../accountKey';
import { formatHexKey } from '../utils';
import { getECIESKeySetupModalTemplate } from '../templates';
import { showToast } from '../fetchFiles';

// Flag to prevent concurrent uploads
let isUploadingECIESKey = false;

// Check if account has a key and update header display
export async function checkAndUpdateAccountKeyStatus(walletAddress: string): Promise<void> {
    const $keyStatus = $('#accountKeyStatus');
    if ($keyStatus.length === 0) return;

    try {
        const hasKey = await hasAccountKey(walletAddress);
        
        let keyInfoHtml = '';
        let buttonHtml = '';
        
        if (hasKey) {
            // Key exists - display the public key and show Delete button
            try {
                const apiEndpoint = 'https://storage.datavault.space';
                const response = await fetch(
                    `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/ecies-public-key`
                );
                if (response.ok) {
                    const data = await response.json();
                    // Response structure: { "ecies_public_key": "04..." } (matches QueryECIESPublicKeyResponse protobuf)
                    const publicKey = data.ecies_public_key || '';
                    if (publicKey) {
                        const formattedKey = formatHexKey(publicKey);
                        keyInfoHtml = `<span class="text-muted small me-2" style="font-family: monospace;">ECIES Key: ${formattedKey}</span>`;
                    }
                }
            } catch (error) {
                console.error('Error fetching ECIES public key for display:', error);
                keyInfoHtml = '<span class="text-muted small me-2">Key: Error loading</span>';
            }
            
            // Show only Delete button when key exists (don't show Generate button)
            buttonHtml = `
                <button id="deleteKeyBtn" class="btn btn-sm btn-outline-danger">
                    Delete Public Key
                </button>
            `;
        } else {
            // No key - only show Upload button
            buttonHtml = `
                <button id="generateKeyBtn" class="btn btn-sm btn-outline-primary">
                    Generate ECIES Public Key
                </button>
            `;
        }
        
        $keyStatus.html(`${keyInfoHtml}${buttonHtml}`);
    } catch (error) {
        console.error('Error checking account key status:', error);
        // On error, still show the button
        $keyStatus.html(`
            <button id="generateKeyBtn" class="btn btn-sm btn-outline-primary">
                Generate ECIES Public Key
            </button>
        `);
    }
}

// Check ECIES key and show setup modal if needed
export async function checkECIESKeyAndShowModal(walletAddress: string): Promise<void> {
    try {
        const { hasAccountKey } = await import('../accountKey');
        const hasKey = await hasAccountKey(walletAddress);
        
        if (!hasKey) {
            // Key doesn't exist, show setup modal
            showECIESKeySetupModal(walletAddress);
        }
    } catch (error) {
        console.error('Error checking ECIES key:', error);
        // On error, still show the modal to be safe
        showECIESKeySetupModal(walletAddress);
    }
}

// Show ECIES key setup modal (non-dismissible)
function showECIESKeySetupModal(walletAddress: string): void {
    // Check if modal already exists and is showing
    let modalElement = document.getElementById('eciesKeySetupModal');
    
    if (modalElement) {
        // Check if modal is already visible
        const modal = (window as any).bootstrap.Modal.getInstance(modalElement);
        if (modal && modal._isShown) {
            // Modal is already showing, don't show again
            return;
        }
    }
    
    if (!modalElement) {
        // Create modal from template
        const modalHtml = getECIESKeySetupModalTemplate();
        $('body').append(modalHtml);
        modalElement = document.getElementById('eciesKeySetupModal');
    }

    if (!modalElement) {
        console.error('Failed to create ECIES key setup modal');
        return;
    }

    // Set up button handlers - scope to modal element to avoid conflicts with other buttons
    const $modal = $(modalElement);
    
    // Use event delegation on the modal to ensure handlers work
    $modal.off('click', '#generateECIESKeyBtn').on('click', '#generateECIESKeyBtn', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleECIESKeyGenerationFromModal(walletAddress);
    });
    
    $modal.off('click', '#getTokensBtn').on('click', '#getTokensBtn', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleGetTokensFromModal(walletAddress);
    });

    // Show modal (non-dismissible: backdrop static, keyboard disabled)
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
}

// Handle Get Tokens button click from modal
async function handleGetTokensFromModal(walletAddress: string): Promise<void> {
    const $button = $('#getTokensBtn');
    const $buttonText = $('#getTokensBtnText');
    const $spinner = $('#getTokensSpinner');
    const $status = $('#eciesKeySetupStatus');
    const $statusText = $('#eciesKeySetupStatusText');

    // Disable button and show loading state
    $button.prop('disabled', true);
    $buttonText.text('Requesting...');
    $spinner.removeClass('d-none');
    $status.removeClass('d-none');
    $status.removeClass('alert-success alert-danger').addClass('alert-info');
    $statusText.text('Requesting tokens from faucet...');

    try {
        const { requestTokensFromFaucet } = await import('../faucet');
        const result = await requestTokensFromFaucet(walletAddress, '1000000');

        if (result.success) {
            const message = result.tx_hash 
                ? `Tokens requested successfully! Transaction: ${result.tx_hash.substring(0, 16)}...`
                : result.message || 'Tokens requested successfully!';
            $statusText.text(message);
            $status.removeClass('alert-info').addClass('alert-success');
        } else {
            $statusText.text(`Error: ${result.error || 'Failed to request tokens from faucet'}`);
            $status.removeClass('alert-info').addClass('alert-danger');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens';
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('alert-info').addClass('alert-danger');
    } finally {
        // Re-enable button
        $button.prop('disabled', false);
        $buttonText.text('Get Tokens');
        $spinner.addClass('d-none');
    }
}

// Handle ECIES key generation from modal
async function handleECIESKeyGenerationFromModal(walletAddress: string): Promise<void> {
    const $button = $('#generateECIESKeyBtn');
    const $buttonText = $('#generateECIESKeyBtnText');
    const $spinner = $('#generateECIESKeySpinner');
    const $status = $('#eciesKeySetupStatus');
    const $statusText = $('#eciesKeySetupStatusText');

    // Prevent concurrent uploads
    if (isUploadingECIESKey) {
        return;
    }

    // Disable button and show loading state
    isUploadingECIESKey = true;
    $button.prop('disabled', true);
    $buttonText.text('Generating...');
    $spinner.removeClass('d-none');
    $status.removeClass('d-none');
    $statusText.text('Generating and uploading ECIES key...');

    try {
        const { uploadECIESPublicKey } = await import('../generateAccountKey');
        const result = await uploadECIESPublicKey();

        if (result.success) {
            $statusText.text('ECIES key generated and uploaded successfully!');
            $status.removeClass('alert-info').addClass('alert-success');
            
            // Wait a moment to show success message, then close modal
            setTimeout(async () => {
                const modalElement = document.getElementById('eciesKeySetupModal');
                if (modalElement) {
                    const modal = (window as any).bootstrap.Modal.getInstance(modalElement);
                    if (modal) {
                        modal.hide();
                        // Remove modal from DOM after hiding
                        $(modalElement).on('hidden.bs.modal', () => {
                            $(modalElement).remove();
                        });
                    }
                }
                
                // Refresh the key status display
                await checkAndUpdateAccountKeyStatus(walletAddress);
            }, 1500);
        } else {
            $statusText.text(`Error: ${result.error || 'Unknown error'}`);
            $status.removeClass('alert-info').addClass('alert-danger');
            // Re-enable button
            $button.prop('disabled', false);
            $buttonText.text('Generate ECIES Key');
            $spinner.addClass('d-none');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('alert-info').addClass('alert-danger');
        // Re-enable button
        $button.prop('disabled', false);
        $buttonText.text('Generate ECIES Key');
        $spinner.addClass('d-none');
    } finally {
        isUploadingECIESKey = false;
    }
}

// Handle delete ECIES public key button click
export async function handleDeleteAccountKey(): Promise<void> {
    const $button = $('#deleteKeyBtn');
    const walletAddress = sessionStorage.getItem('walletAddress');
    
    if (!walletAddress) {
        showToast('Wallet address not found', 'error');
        return;
    }

    // Confirm deletion
    const confirmed = confirm('Are you sure you want to delete your ECIES public key? This will prevent others from sharing files with you until you upload a new key.');
    if (!confirmed) {
        return;
    }

    // Disable button and show loading state
    $button.prop('disabled', true);
    const originalText = $button.text();
    $button.html(`
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Deleting...
    `);

    try {
        const { deleteECIESPublicKey } = await import('../generateAccountKey');
        const result = await deleteECIESPublicKey();

        if (result.success) {
            showToast(
                `ECIES public key deleted successfully! Tx: ${result.transactionHash?.substring(0, 8)}...`,
                'success'
            );

            // Refresh the key status display (this will update the button state)
            await checkAndUpdateAccountKeyStatus(walletAddress);
        } else {
            showToast(`Failed to delete ECIES public key: ${result.error || 'Unknown error'}`, 'error');
            // Re-enable button
            $button.prop('disabled', false);
            $button.text(originalText);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        showToast(`Error deleting ECIES public key: ${errorMessage}`, 'error');
        // Re-enable button
        $button.prop('disabled', false);
        $button.text(originalText);
    }
}

// Handle generate account key button click
export async function handleGenerateAccountKey(): Promise<void> {
    // Prevent concurrent uploads
    if (isUploadingECIESKey) {
        console.log('ECIES key upload already in progress, ignoring click');
        return;
    }

    const $button = $('#generateKeyBtn');
    const walletAddress = sessionStorage.getItem('walletAddress');
    
    if (!walletAddress) {
        showToast('Wallet address not found', 'error');
        return;
    }

    // Check if key already exists
    try {
        const { hasAccountKey } = await import('../accountKey');
        const hasKey = await hasAccountKey(walletAddress);
        if (hasKey) {
            showToast('ECIES public key already exists for this account', 'info');
            // Refresh the display
            await checkAndUpdateAccountKeyStatus(walletAddress);
            return;
        }
    } catch (error) {
        console.warn('Could not check if key exists, proceeding with upload:', error);
    }

    // Set flag and disable button
    isUploadingECIESKey = true;
    $button.prop('disabled', true);
    const originalText = $button.text();
    $button.html(`
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Uploading...
    `);

    try {
        const { uploadECIESPublicKey } = await import('../generateAccountKey');
        const result = await uploadECIESPublicKey();

        if (result.success) {
            showToast(
                `ECIES public key uploaded successfully! Tx: ${result.transactionHash?.substring(0, 8)}...`,
                'success'
            );

            // Refresh the key status display (this will update the button state)
            await checkAndUpdateAccountKeyStatus(walletAddress);
        } else {
            showToast(`Failed to generate ECIES public key: ${result.error || 'Unknown error'}`, 'error');
            // Re-enable button
            $button.prop('disabled', false);
            $button.text(originalText);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        showToast(`Error uploading ECIES public key: ${errorMessage}`, 'error');
        // Re-enable button
        $button.prop('disabled', false);
        $button.text(originalText);
    } finally {
        // Always clear the flag
        isUploadingECIESKey = false;
    }
}

