// Share file operations

import { shareFile } from '../shareFile';
import { getShareFileModalTemplate } from '../templates';
import { showToast } from './utils';
import { encryptFileKeyWithECIES } from '../osd-blockchain-sdk';
import { getAccountKey } from '../accountKey';

// Show share file modal dialog
// Note: encryptedFileKey parameter kept for backwards compatibility but not used anymore
// We now get the account key directly from blockchain
export function showShareFileModal(merkleRoot: string, fileName: string, walletAddress: string, encryptedFileKey?: string): void {
    // Remove any existing modal
    $('#shareFileModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getShareFileModalTemplate(fileName);
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop (non-dismissible)
    const modalElement = document.getElementById('shareFileModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    // Set default expiration date (30 days from now) and focus on input when modal is shown
    $(modalElement).on('shown.bs.modal', () => {
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
    });
    
    // Handle confirm button click
    $('#confirmShareFileBtn').off('click').on('click', async () => {
        await handleShareFileSubmit(merkleRoot, fileName, walletAddress, modal);
    });
    
    // Handle cancel button click
    $('#cancelShareFileBtn').off('click').on('click', () => {
        modal.hide();
    });
    
    // Handle Enter key in input fields
    $('#shareFileForm input').off('keypress').on('keypress', (e: JQuery.KeyPressEvent) => {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            $('#confirmShareFileBtn').click();
        }
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#shareFileModal').remove();
    });
}

// Handle share file form submission
async function handleShareFileSubmit(merkleRoot: string, fileName: string, walletAddress: string, modal: any): Promise<void> {
    const $confirmBtn = $('#confirmShareFileBtn');
    const $cancelBtn = $('#cancelShareFileBtn');
    const $btnText = $('#shareFileBtnText');
    const $spinner = $('#shareFileSpinner');
    const $status = $('#shareFileStatus');
    const $statusText = $('#shareFileStatusText');
    
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
        $statusText.text('Getting account key...');
        
        // Step 1: Get account's symmetric key from blockchain (encrypted with owner's key)
        const accountKey = await getAccountKey(walletAddress);
        
        // Step 2: Encrypt account key with recipient's public key using true ECIES
        $statusText.text('Encrypting account key for recipient...');
        const recipientEncryptedKeyBytes = await encryptFileKeyWithECIES(accountKey, shareAddress);
        const recipientEncryptedKeyBase64 = btoa(String.fromCharCode(...recipientEncryptedKeyBytes));
        
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

