// Create folder functionality

import { createDirectory } from '../createDirectory';
import { getCreateFolderModalTemplate } from '../templates';
import { showToast } from './utils';
import { fetchFiles } from './index';

// Show create folder modal dialog
export function showCreateFolderModal(walletAddress: string, currentPath: string): void {
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

