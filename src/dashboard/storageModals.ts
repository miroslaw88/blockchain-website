// Storage modals (buy and extend storage)

import { getExtendStorageModalTemplate, getBuyStorageModalTemplate } from '../templates';
import { calculateBuyStoragePayment, calculateExtendStoragePayment } from './payment';
import { buyStorage } from '../buyStorage';
import { extendStorageDuration } from '../extendStorage';
import { fetchStorageStats } from '../fetchStorageStats';

// Show buy storage modal
export function showBuyStorageModal(showExtendStorageModalCallback: () => Promise<void>): void {
    // Remove any existing modal
    $('#buyStorageModal').remove();
    
    // Create modal HTML using template
    const modalHTML = getBuyStorageModalTemplate();
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal
    const modalElement = document.getElementById('buyStorageModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement);
    modal.show();
    
    // Calculate initial payment (convert GB to bytes: 1 GB = 1073741824 bytes)
    const initialStorageGB = parseFloat($('#storageGB').val() as string) || 1;
    const initialStorageBytes = Math.round(initialStorageGB * 1073741824);
    const initialPayment = calculateBuyStoragePayment(initialStorageBytes);
    $('#payment').val(initialPayment);
    
    // Update payment when storage GB changes
    $('#storageGB').off('input change').on('input change', () => {
        const storageGB = parseFloat($('#storageGB').val() as string) || 0;
        if (storageGB > 0) {
            const storageBytes = Math.round(storageGB * 1073741824);
            const payment = calculateBuyStoragePayment(storageBytes);
            $('#payment').val(payment);
        }
    });
    
    // Focus on first input when modal is shown
    $(modalElement).on('shown.bs.modal', () => {
        $('#storageGB').focus();
    });
    
    // Handle form submission
    $('#submitBuyStorageBtn').off('click').on('click', async () => {
        await handleBuyStorageSubmit(modal, showExtendStorageModalCallback);
    });
    
    // Handle Enter key in input fields
    $('#buyStorageForm input').off('keypress').on('keypress', (e: JQuery.KeyPressEvent) => {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            $('#submitBuyStorageBtn').click();
        }
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#buyStorageModal').remove();
    });
}

// Handle buy storage form submission
async function handleBuyStorageSubmit(modal: any, showExtendStorageModalCallback: () => Promise<void>): Promise<void> {
    const $submitBtn = $('#submitBuyStorageBtn');
    const $cancelBtn = $('.modal-footer .btn-secondary');
    const $btnText = $('#buyStorageBtnText');
    const $spinner = $('#buyStorageSpinner');
    const $status = $('#buyStorageStatus');
    const $statusText = $('#buyStorageStatusText');

    if ($submitBtn.length === 0) return;

    try {
        // Get form values
        const storageGB = parseFloat($('#storageGB').val() as string);
        const durationDays = parseInt($('#durationDays').val() as string);
        const payment = ($('#payment').val() as string).trim();

        // Validate inputs
        if (isNaN(storageGB) || storageGB <= 0) {
            throw new Error('Invalid storage size');
        }
        // Convert GB to bytes (1 GB = 1073741824 bytes)
        const storageBytes = Math.round(storageGB * 1073741824);
        if (storageBytes <= 0) {
            throw new Error('Invalid storage size');
        }
        if (isNaN(durationDays) || durationDays <= 0) {
            throw new Error('Invalid duration');
        }
        if (!payment) {
            throw new Error('Payment amount is required');
        }

        // Show loading state
        $submitBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Processing...');
        $status.removeClass('d-none');
        $statusText.text('Processing transaction...');

        // Execute buy storage transaction
        const txHash = await buyStorage(storageBytes, durationDays, payment);

        // Update status to show success
        $statusText.text('Storage purchase successful!');
        $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');

        // Show success toast
        import('../fetchFiles').then((module) => {
            module.showToast(`Storage purchase successful! Transaction: ${txHash.substring(0, 16)}...`, 'success');
        });

        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
            
            // Refresh storage stats
            const walletAddress = sessionStorage.getItem('walletAddress');
            if (walletAddress) {
                fetchStorageStats(walletAddress, () => showBuyStorageModal(showExtendStorageModalCallback), showExtendStorageModalCallback);
            }
        }, 1500);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Buy storage failed';
        console.error('Buy storage error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        import('../fetchFiles').then((module) => {
            module.showToast(`Purchase failed: ${errorMessage}`, 'error');
        });
        
        // Re-enable buttons so user can try again or cancel
        $submitBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Buy Storage');
    }
}

// Show extend storage modal
export async function showExtendStorageModal(showBuyStorageModalCallback: () => void): Promise<void> {
    // Remove any existing modal
    $('#extendStorageModal').remove();
    
    // Get current storage subscription info to calculate payment
    const walletAddress = sessionStorage.getItem('walletAddress');
    if (!walletAddress) {
        throw new Error('Wallet not connected');
    }
    
    // Fetch current storage subscription to get storage_bytes
    let currentStorageBytes = 0;
    try {
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/storage`);
        if (response.ok) {
            const data = await response.json();
            const sub = data.subscription;
            currentStorageBytes = parseInt(sub.storage_bytes || sub.storageBytes || '0', 10);
        }
    } catch (error) {
        console.error('Error fetching storage info for payment calculation:', error);
    }
    
    // Create modal HTML using template
    const modalHTML = getExtendStorageModalTemplate();
    
    // Append modal to body
    $('body').append(modalHTML);
    
    // Initialize Bootstrap modal with static backdrop
    const modalElement = document.getElementById('extendStorageModal');
    if (!modalElement) return;
    
    const modal = new (window as any).bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
    
    // Store current storage bytes in a data attribute for calculation
    $(modalElement).data('storageBytes', currentStorageBytes);
    
    // Calculate initial payment
    const initialDuration = parseInt($('#extendDurationDays').val() as string) || 30;
    const initialPayment = calculateExtendStoragePayment(currentStorageBytes, initialDuration);
    $('#extendPayment').val(initialPayment);
    
    // Update payment when duration changes
    $('#extendDurationDays').off('input change').on('input change', () => {
        const durationDays = parseInt($('#extendDurationDays').val() as string) || 0;
        if (durationDays > 0 && currentStorageBytes > 0) {
            const payment = calculateExtendStoragePayment(currentStorageBytes, durationDays);
            $('#extendPayment').val(payment);
        }
    });
    
    // Focus on input when modal is shown
    $(modalElement).on('shown.bs.modal', () => {
        $('#extendDurationDays').focus();
    });
    
    // Handle form submission
    $('#extendStorageForm').off('submit').on('submit', async (e) => {
        e.preventDefault();
        await handleExtendStorageSubmit(modal, showBuyStorageModalCallback);
    });
    
    // Handle Enter key in input field
    $('#extendStorageForm input').off('keypress').on('keypress', (e: JQuery.KeyPressEvent) => {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            $('#submitExtendStorageBtn').click();
        }
    });
    
    // Handle cancel button click
    $('#cancelExtendStorageBtn').off('click').on('click', () => {
        modal.hide();
    });
    
    // Clean up modal when hidden
    $(modalElement).on('hidden.bs.modal', () => {
        $('#extendStorageModal').remove();
    });
}

// Handle extend storage form submission
async function handleExtendStorageSubmit(modal: any, showBuyStorageModalCallback: () => void): Promise<void> {
    const $submitBtn = $('#submitExtendStorageBtn');
    const $cancelBtn = $('#cancelExtendStorageBtn');
    const $btnText = $('#extendStorageBtnText');
    const $spinner = $('#extendStorageSpinner');
    const $status = $('#extendStorageStatus');
    const $statusText = $('#extendStorageStatusText');

    try {
        // Get form values
        const durationDays = parseInt($('#extendDurationDays').val() as string);
        const payment = ($('#extendPayment').val() as string).trim();

        // Validate inputs
        if (isNaN(durationDays) || durationDays <= 0) {
            throw new Error('Invalid duration');
        }
        if (!payment) {
            throw new Error('Payment amount is required');
        }

        // Show loading state
        $submitBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btnText.text('Processing...');
        $status.removeClass('d-none').addClass('alert-info').removeClass('alert-danger alert-success');
        $statusText.text('Sending transaction to blockchain...');

        // Execute extend storage transaction
        const txHash = await extendStorageDuration(durationDays, payment);

        // Update status
        $statusText.text('Storage extended successfully!');
        $status.removeClass('d-none alert-info alert-danger').addClass('alert-success');
        
        // Show success toast
        import('../fetchFiles').then((module) => {
            module.showToast(`Storage extended successfully! Tx: ${txHash.substring(0, 6)}...`, 'success');
        });

        // Refresh storage stats
        const walletAddress = sessionStorage.getItem('walletAddress');
        if (walletAddress) {
            fetchStorageStats(walletAddress, showBuyStorageModalCallback, async () => showExtendStorageModal(showBuyStorageModalCallback));
        }
        
        // Close modal after a brief delay
        setTimeout(() => {
            modal.hide();
        }, 1500);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Extend storage failed';
        console.error('Extend storage error:', error);
        
        // Update status to show error
        $statusText.text(`Error: ${errorMessage}`);
        $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
        
        // Show error toast
        import('../fetchFiles').then((module) => {
            module.showToast(`Extension failed: ${errorMessage}`, 'error');
        });
        
        // Re-enable buttons so user can try again or cancel
        $submitBtn.prop('disabled', false);
        $cancelBtn.prop('disabled', false);
        $spinner.addClass('d-none');
        $btnText.text('Extend Storage');
    }
}

