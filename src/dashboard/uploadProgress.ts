// Upload progress utilities

// Helper function to show upload progress toast
export function showUploadProgressToast(file: File, uploadId: string, uploadPath: string): void {
    const $container = $('#toastContainer');
    if ($container.length === 0) {
        // Create container if it doesn't exist
        $('body').append('<div class="toast-container position-fixed top-0 end-0 p-3" id="toastContainer" style="z-index: 11;"></div>');
    }
    
    const fileSize = formatFileSize(file.size);
    const toastId = `upload-toast-${uploadId}`;
    const displayPath = uploadPath || '/';
    
    const $toast = $(`
        <div class="toast bg-primary text-white" role="alert" aria-live="polite" aria-atomic="true" id="${toastId}" data-bs-autohide="false">
            <div class="toast-header bg-primary text-white border-0">
                <strong class="me-auto">📤 Uploading</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                <div class="mb-2">
                    <strong>${file.name}</strong>
                    <small class="d-block text-white-50">${fileSize}</small>
                    <small class="d-block text-white-50 mt-1">
                        <span class="text-white-75">Path:</span> <code class="text-white">${displayPath}</code>
                    </small>
                </div>
                <div class="progress mb-2" style="height: 20px;">
                    <div id="upload-progress-${uploadId}" class="progress-bar progress-bar-striped progress-bar-animated bg-success text-white" 
                         role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                        0%
                    </div>
                </div>
                <small class="d-block" id="upload-status-${uploadId}">Preparing...</small>
            </div>
        </div>
    `);
    
    $('#toastContainer').append($toast);
    
    // Initialize and show toast using Bootstrap (don't auto-hide)
    const toastElement = $toast[0];
    const toast = new (window as any).bootstrap.Toast(toastElement, {
        autohide: false // Don't auto-hide - we'll hide it manually when upload completes
    });
    toast.show();
}

// Helper function to update uploading file progress in toast
export function updateUploadingFileProgress(uploadId: string, progress: number, status: string): void {
    const $progressBar = $(`#upload-progress-${uploadId}`);
    const $status = $(`#upload-status-${uploadId}`);
    
    if ($progressBar.length > 0) {
        $progressBar.css('width', `${progress}%`).attr('aria-valuenow', progress);
        $progressBar.text(`${Math.round(progress)}%`);
    }
    
    if ($status.length > 0) {
        $status.text(status);
    }
}

// Helper function to remove upload progress toast
export function finalizeUploadingFile(uploadId: string, success: boolean): void {
    const toastId = `upload-toast-${uploadId}`;
    const $toast = $(`#${toastId}`);
    
    if ($toast.length > 0) {
        const toastElement = $toast[0];
        const toastInstance = (window as any).bootstrap.Toast.getInstance(toastElement);
        
        if (toastInstance) {
            // Hide the toast
            toastInstance.hide();
            
            // Remove toast element after it's hidden
            $toast.on('hidden.bs.toast', () => {
                $toast.remove();
            });
        } else {
            // If toast instance doesn't exist, just remove the element
            $toast.remove();
        }
    }
}

// Helper function to format file size (duplicate from fetchFiles, but needed here)
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

