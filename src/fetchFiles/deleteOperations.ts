// Delete file and folder operations

import { deleteFile } from '../deleteFile';
import { deleteDirectory } from '../deleteDirectory';
import {
    getDeleteFileModalTemplate,
    getDeleteFolderModalTemplate
} from '../templates';
import { showToast } from './utils';
import { fetchFiles } from './index';

// Show delete file modal dialog
export function showDeleteFileModal(merkleRoot: string, fileName: string, walletAddress: string, currentPath: string): void {
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
        const result = await deleteFile([merkleRoot]);
        
        // Update status
        $statusText.text(`File deleted successfully! (${result.deletedCount} file(s) deleted)`);
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
export function showDeleteFolderModal(folderPath: string, folderName: string, walletAddress: string, currentPath: string): void {
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

