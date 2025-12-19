// Drag and drop functionality

// Track if drag and drop is initialized to prevent duplicate listeners
let dragAndDropInitialized = false;

// Initialize drag and drop
export function initDragAndDrop(handleFiles: (files: FileList) => Promise<void>): void {
    // Prevent duplicate initialization
    if (dragAndDropInitialized) {
        console.warn('Drag and drop already initialized, skipping');
        return;
    }
    
    const $dropZone = $('#dropZone');
    const $fileInput = $('#fileInput');
    
    if ($dropZone.length === 0 || $fileInput.length === 0) return;

    // Mark as initialized
    dragAndDropInitialized = true;

    // Click to browse - only trigger if click is not on the file input itself
    $dropZone.on('click', (e) => {
        // Don't trigger if clicking directly on the file input
        if ($(e.target).is('input[type="file"]')) {
            return;
        }
        $fileInput.trigger('click');
    });

    // Prevent file input click from bubbling to dropZone
    $fileInput.on('click', (e) => {
        e.stopPropagation();
    });

    // Prevent default drag behaviors
    $dropZone.on('dragenter dragover dragleave drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    // Highlight drop zone when item is dragged over it
    $dropZone.on('dragenter dragover', () => {
        $dropZone.addClass('drag-over');
    });

    $dropZone.on('dragleave drop', () => {
        $dropZone.removeClass('drag-over');
    });

    // Handle dropped files
    $dropZone.on('drop', (e) => {
        const dt = (e.originalEvent as DragEvent).dataTransfer;
        if (dt && dt.files) {
            handleFiles(dt.files);
        }
    });

    // Handle file input change - clear input after handling to prevent duplicate events
    $fileInput.on('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
            const files = target.files; // Store files before clearing
            // Clear input to prevent duplicate events if user selects same file again
            target.value = '';
            handleFiles(files);
        }
    });
}

