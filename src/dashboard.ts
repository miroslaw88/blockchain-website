// Dashboard functionality
import { getKeplr, CHAIN_ID, deriveECIESPrivateKey, eciesKeyMaterialCache, updateWalletAddressDisplay } from './utils';
import { fetchFiles } from './fetchFiles';
import { buyStorage } from './buyStorage';
import { postFile } from './postFile';
import { fetchStorageStats } from './fetchStorageStats';
import { extendStorageDuration } from './extendStorage';
import { getExtendStorageModalTemplate } from './templates';
import { getBuyStorageModalTemplate } from './templates';

// Payment calculation constants
const PRICE_PER_BYTE = 0.0000000001; // $0.0000000001 per byte
const TOKEN_PRICE = 1.00; // $1.00 per stake token

// Calculate payment for buy storage: storage_bytes * price_per_byte * token_price
function calculateBuyStoragePayment(storageBytes: number): string {
    const stakeAmount = storageBytes * PRICE_PER_BYTE * TOKEN_PRICE;
    // Round to 6 decimal places (matching stake decimals)
    const rounded = Math.round(stakeAmount * 1000000) / 1000000;
    return `${rounded}stake`;
}

// Calculate payment for extend storage: storage_bytes * duration_days * price_per_byte * token_price
function calculateExtendStoragePayment(storageBytes: number, durationDays: number): string {
    const stakeAmount = storageBytes * durationDays * PRICE_PER_BYTE * TOKEN_PRICE;
    // Round to 6 decimal places (matching stake decimals)
    const rounded = Math.round(stakeAmount * 1000000) / 1000000;
    return `${rounded}stake`;
}

export namespace Dashboard {
    // Flag to prevent concurrent uploads
    let isUploading = false;

    // Disconnect wallet function
    async function disconnectWallet(): Promise<void> {
        try {
            const keplr = getKeplr();
            if (keplr && keplr.disable) {
                await keplr.disable(CHAIN_ID);
            }
        } catch (error) {
            console.error('Error disconnecting wallet:', error);
        } finally {
            // Clear ECIES key cache
            Object.keys(eciesKeyMaterialCache).forEach(key => {
                delete eciesKeyMaterialCache[key];
            });
            
            // Clear all wallet session data
            sessionStorage.removeItem('walletConnected');
            sessionStorage.removeItem('walletAddress');
            sessionStorage.removeItem('walletName');
            sessionStorage.removeItem('chainId');
            
            // Clear wallet address display
            updateWalletAddressDisplay(null);
            
            // Switch back to wallet connection view (no redirect)
            import('./app').then(({ switchToWalletConnection }) => {
                switchToWalletConnection();
            });
        }
    }



    // Track if drag and drop is initialized to prevent duplicate listeners
    let dragAndDropInitialized = false;

    // Initialize drag and drop
    function initDragAndDrop(): void {
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


    // Hash filename (like OSD system protocol)
    async function hashFilename(filename: string): Promise<string> {
        // Hash filename + timestamp (like OSD system: fileMeta.name + Date.now().toString())
        const timestamp = Date.now().toString();
        const dataToHash = filename + timestamp;
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataToHash));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Encrypt file using chunked AES-256-GCM with ECIES key derivation (OSD system-style)
    // Returns array of encrypted chunks (each chunk is uploaded individually)
    async function encryptFile(file: File, userAddress: string): Promise<Blob[]> {
        const encryptionChunkSize = 32 * 1024 * 1024; // 32MB chunks (like OSD system)
        
        // Derive ECIES private key from wallet signature
        const eciesKeyMaterial = await deriveECIESPrivateKey(userAddress);
        
        // Derive AES-256-GCM key from ECIES private key material
        const aesKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: new Uint8Array(0), // No salt for deterministic key
                iterations: 10000,
                hash: 'SHA-256'
            },
            eciesKeyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        
        const encryptedChunks: Blob[] = [];
        
        // Encrypt file in chunks
        for (let i = 0; i < file.size; i += encryptionChunkSize) {
            const chunkBlob = file.slice(i, i + encryptionChunkSize);
            const chunkData = await chunkBlob.arrayBuffer();
            
            // Generate IV (12 bytes for AES-GCM) for each chunk
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt chunk with AES-256-GCM (includes authentication tag)
            const encryptedChunkData = await crypto.subtle.encrypt(
                { 
                    name: 'AES-GCM',
                    iv: iv,
                    tagLength: 128 // 128-bit authentication tag
                },
                aesKey,
                chunkData
            );
            
            // Format: [8-byte size header][12-byte IV][encrypted chunk + 16-byte tag]
            // Size header includes: IV (12) + encrypted data + tag (16)
            const encryptedChunkArray = new Uint8Array(encryptedChunkData);
            const chunkSize = iv.length + encryptedChunkArray.length; // 12 + encrypted + 16
            
            // Create size header (8 bytes, padded with zeros)
            const sizeHeader = chunkSize.toString().padStart(8, '0');
            const sizeHeaderBytes = new TextEncoder().encode(sizeHeader);
            
            // Combine: size header + IV + encrypted chunk
            const combinedChunk = new Uint8Array(sizeHeaderBytes.length + chunkSize);
            combinedChunk.set(sizeHeaderBytes, 0);
            combinedChunk.set(iv, sizeHeaderBytes.length);
            combinedChunk.set(encryptedChunkArray, sizeHeaderBytes.length + iv.length);
            
            encryptedChunks.push(new Blob([combinedChunk]));
        }
        
        // Return array of encrypted chunks (each will be uploaded individually)
        return encryptedChunks;
    }

    // Calculate Merkle root (SHA256 hash)
    async function calculateMerkleRoot(data: ArrayBuffer): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Get random storage providers (deprecated - providers now come from transaction response)
    // Keeping for backwards compatibility but not used in upload flow
    async function getRandomStorageProviders(count: number): Promise<{ providers: Array<{ providerAddress: string }> }> {
        const apiEndpoint = 'https://storage.datavault.space';
        try {
            const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/storage-providers?count=${count}`);
            if (response.ok) {
                return await response.json();
            } else if (response.status === 501) {
                console.warn('Storage providers endpoint not implemented (501). Providers will be obtained from transaction response.');
            }
        } catch (error) {
            console.error('Error fetching storage providers:', error);
        }
        // Fallback: return empty providers list
        // Note: Providers should come from the postFile transaction response instead
        return { providers: [] };
    }


    // Show buy storage modal
    async function showExtendStorageModal(): Promise<void> {
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
            await handleExtendStorageSubmit(modal);
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
    async function handleExtendStorageSubmit(modal: any): Promise<void> {
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
            import('./fetchFiles').then((module) => {
                module.showToast(`Storage extended successfully! Tx: ${txHash.substring(0, 6)}...`, 'success');
            });

            // Refresh storage stats
            const walletAddress = sessionStorage.getItem('walletAddress');
            if (walletAddress) {
                fetchStorageStats(walletAddress, showBuyStorageModal, showExtendStorageModal);
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
            import('./fetchFiles').then((module) => {
                module.showToast(`Extension failed: ${errorMessage}`, 'error');
            });
            
            // Re-enable buttons so user can try again or cancel
            $submitBtn.prop('disabled', false);
            $cancelBtn.prop('disabled', false);
            $spinner.addClass('d-none');
            $btnText.text('Extend Storage');
        }
    }

    function showBuyStorageModal(): void {
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
            await handleBuyStorageSubmit(modal);
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
    async function handleBuyStorageSubmit(modal: any): Promise<void> {
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
            import('./fetchFiles').then((module) => {
                module.showToast(`Storage purchase successful! Transaction: ${txHash.substring(0, 16)}...`, 'success');
            });

            // Close modal after a brief delay
            setTimeout(() => {
                modal.hide();
                
                // Refresh storage stats
                const walletAddress = sessionStorage.getItem('walletAddress');
                if (walletAddress) {
                    fetchStorageStats(walletAddress, showBuyStorageModal, showExtendStorageModal);
                }
            }, 1500);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Buy storage failed';
            console.error('Buy storage error:', error);
            
            // Update status to show error
            $statusText.text(`Error: ${errorMessage}`);
            $status.removeClass('d-none alert-info alert-success').addClass('alert-danger');
            
            // Show error toast
            import('./fetchFiles').then((module) => {
                module.showToast(`Purchase failed: ${errorMessage}`, 'error');
            });
            
            // Re-enable buttons so user can try again or cancel
            $submitBtn.prop('disabled', false);
            $cancelBtn.prop('disabled', false);
            $spinner.addClass('d-none');
            $btnText.text('Buy Storage');
        }
    }



    // Upload chunk to storage provider
    async function uploadChunkToStorageProvider(
        providerAddress: string,
        encryptedChunk: Blob,
        chunkIndex: number,
        totalChunks: number,
        combinedMerkleRoot: string,
        chunkMerkleRoot: string,
        owner: string,
        expirationTime: number,
        metadata: { name: string; content_type: string }
    ): Promise<void> {
        console.log(`=== Uploading chunk ${chunkIndex + 1}/${totalChunks} ===`);
        console.log('Provider address:', providerAddress);
        console.log('Chunk size:', encryptedChunk.size, 'bytes');
        console.log('Chunk merkle root:', chunkMerkleRoot);
        console.log('Combined merkle root:', combinedMerkleRoot);
        console.log('Owner:', owner);
        
        const formData = new FormData();
        formData.append('file', encryptedChunk, `chunk_${chunkIndex}.bin`);
        formData.append('merkle_root', chunkMerkleRoot); // Send individual chunk's merkle root
        formData.append('combined_merkle_root', combinedMerkleRoot); // Also send combined merkle root for file identification
        formData.append('owner', owner);
        formData.append('expiration_time', expirationTime.toString());
        formData.append('chunk_index', chunkIndex.toString());
        formData.append('total_chunks', totalChunks.toString());
        formData.append('metadata', JSON.stringify(metadata));
        
        const uploadUrl = `https://storage.datavault.space/api/v1/files/upload`;
        console.log('Upload URL:', uploadUrl);

        try {
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Chunk ${chunkIndex + 1} upload failed - Response text:`, errorText);
                throw new Error(`Chunk ${chunkIndex + 1} upload failed: ${response.status} ${errorText}`);
            }
            
            const responseText = await response.text();
            console.log(`Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`);
        } catch (error) {
            console.error(`=== Chunk ${chunkIndex + 1} Upload Error ===`);
            console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
            console.error('Error message:', error instanceof Error ? error.message : String(error));
            throw error;
        }
    }


    // Helper function to show upload progress toast
    function showUploadProgressToast(file: File, uploadId: string, uploadPath: string): void {
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
    function updateUploadingFileProgress(uploadId: string, progress: number, status: string): void {
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
    function finalizeUploadingFile(uploadId: string, success: boolean): void {
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
    function formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Main upload file function
    async function uploadFile(file: File): Promise<void> {
        // Prevent concurrent uploads
        if (isUploading) {
            console.warn('Upload already in progress, ignoring duplicate request');
            return;
        }

        const $contentArea = $('#contentArea');
        const $dropZone = $('#dropZone');
        
        if ($contentArea.length === 0) return;

        // Set uploading flag
        isUploading = true;

        // Show processing state
        $dropZone.css({ opacity: '0.5', pointerEvents: 'none' });

        // Generate unique upload ID
        const uploadId = 'upload-' + Date.now();

        try {
            // Get current directory path from sessionStorage (set when navigating folders)
            let currentPath = sessionStorage.getItem('currentDirectoryPath') || '/';
            
            // Show upload progress toast
            showUploadProgressToast(file, uploadId, currentPath);
            updateUploadingFileProgress(uploadId, 0, 'Connecting to wallet...');

            // Step 1: Connect to Keplr
            const keplr = getKeplr();
            if (!keplr) {
                throw new Error('Keplr not available');
            }

            await keplr.enable(CHAIN_ID);
            // Get wallet address - use the same method as wallet connection (bech32Address)
            // This ensures we use the same address format that was used to cache the ECIES key
            const key = await (keplr as any).getKey(CHAIN_ID);
            const userAddress = key.bech32Address;

            // Step 2: Calculate original file hash (needed for decryption later)
            updateUploadingFileProgress(uploadId, 5, 'Calculating file hash...');
            const fileData = await file.arrayBuffer();
            const originalFileHash = await calculateMerkleRoot(fileData);

            // Step 3: Encrypt file (returns array of encrypted chunks)
            updateUploadingFileProgress(uploadId, 10, 'Encrypting file...');
            const encryptedChunks = await encryptFile(file, userAddress);

            // Step 4: Calculate Merkle roots
            // - Individual merkle root for each chunk (for provider validation)
            // - Combined merkle root from all chunks (for blockchain transaction)
            updateUploadingFileProgress(uploadId, 20, 'Calculating encrypted file hash...');
            
            // Calculate merkle root for each chunk
            const chunkMerkleRoots: string[] = [];
            for (const chunk of encryptedChunks) {
                const chunkData = await chunk.arrayBuffer();
                const chunkMerkleRoot = await calculateMerkleRoot(chunkData);
                chunkMerkleRoots.push(chunkMerkleRoot);
            }
            
            // Calculate combined merkle root (for blockchain transaction)
            const combinedChunksArray = new Uint8Array(
                encryptedChunks.reduce((total, chunk) => total + chunk.size, 0)
            );
            let offset = 0;
            for (const chunk of encryptedChunks) {
                const chunkData = await chunk.arrayBuffer();
                combinedChunksArray.set(new Uint8Array(chunkData), offset);
                offset += chunkData.byteLength;
            }
            const combinedMerkleRoot = await calculateMerkleRoot(combinedChunksArray.buffer);
            
            // Calculate total encrypted size
            const totalEncryptedSize = encryptedChunks.reduce((sum, chunk) => sum + chunk.size, 0);

            // Step 5: Hash filename (like OSD system protocol)
            updateUploadingFileProgress(uploadId, 30, 'Processing filename...');
            const hashedFileName = await hashFilename(file.name);

            // Step 6: Post file to blockchain (providers will be returned in the response)
            // Include original file hash and original filename in metadata for decryption
            updateUploadingFileProgress(uploadId, 40, 'Posting transaction to blockchain...');
            const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
            
            // Use currentPath already retrieved above
            // Normalize empty path to empty string (not '/') for metadata
            if (currentPath === '/') {
                currentPath = '';
            }
            
            const metadata = {
                name: hashedFileName, // Store hashed filename (like OSD system)
                original_name: file.name, // Store original filename for display/download
                content_type: file.type || 'application/octet-stream',
                original_file_hash: originalFileHash, // Store original hash for decryption
                path: currentPath // Store current directory path
            };
            const postFileResult = await postFile(
                combinedMerkleRoot,
                totalEncryptedSize,
                expirationTime,
                3,
                metadata
            );

            // Step 7: Upload chunks to storage provider (use providers from transaction response)
            if (postFileResult.providers && postFileResult.providers.length > 0) {
                console.log('=== Storage Provider Upload ===');
                console.log('Providers received:', postFileResult.providers);
                console.log('Primary provider index:', postFileResult.primaryProviderIndex);
                
                // Use primary provider index if available, otherwise use first provider
                const providerIndex = postFileResult.primaryProviderIndex >= 0 
                    ? postFileResult.primaryProviderIndex 
                    : 0;
                const provider = postFileResult.providers[providerIndex];
                
                console.log('Selected provider index:', providerIndex);
                console.log('Selected provider:', provider);
                console.log('Provider address:', provider.providerAddress);
                console.log('Total encrypted size:', totalEncryptedSize, 'bytes');
                console.log('Number of chunks:', encryptedChunks.length);
                console.log('Combined merkle root:', combinedMerkleRoot);
                console.log('Preparing to upload chunks to:', `https://storage.datavault.space/api/v1/files/upload`);
                
                // Upload chunks with progress updates
                const totalChunks = encryptedChunks.length;
                updateUploadingFileProgress(uploadId, 50, 'Uploading to storage provider...');
                
                for (let i = 0; i < encryptedChunks.length; i++) {
                    // Update progress (50-90% for chunk uploads)
                    const chunkProgress = 50 + ((i + 1) / totalChunks) * 40;
                    updateUploadingFileProgress(uploadId, chunkProgress, `Uploading chunk ${i + 1}/${totalChunks}...`);
                    
                    await uploadChunkToStorageProvider(
                        provider.providerAddress, 
                        encryptedChunks[i], 
                        i,
                        totalChunks,
                        combinedMerkleRoot, // Combined merkle root for file identification
                        chunkMerkleRoots[i], // Individual chunk merkle root for validation
                        userAddress,
                        expirationTime,
                        metadata
                    );
                }
                
                console.log('Upload to storage provider completed successfully');
                updateUploadingFileProgress(uploadId, 95, 'Finalizing...');
            } else {
                console.warn('No storage providers assigned. File may be added to pending queue.');
                console.log('PostFileResult:', postFileResult);
            }

            // Success - update progress to 100% and refresh files list
            updateUploadingFileProgress(uploadId, 100, 'Complete!');
            
            // Remove uploading entry and refresh files list
            setTimeout(() => {
                finalizeUploadingFile(uploadId, true);
                
                // Refresh files list to show the new file (use current path if available)
                const walletAddress = sessionStorage.getItem('walletAddress');
                const currentPath = sessionStorage.getItem('currentDirectoryPath') || '';
                if (walletAddress) {
                    fetchFiles(walletAddress, currentPath);
                }
            }, 500);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'File upload failed';
            console.error('Upload error:', error);
            
            // Update toast to show error state
            const toastId = `upload-toast-${uploadId}`;
            const $toast = $(`#${toastId}`);
            if ($toast.length > 0) {
                // Change toast to error style
                $toast.removeClass('bg-primary').addClass('bg-danger');
                $toast.find('.toast-header').removeClass('bg-primary').addClass('bg-danger');
                updateUploadingFileProgress(uploadId, 0, `Error: ${errorMessage}`);
            }
            
            // Remove error toast after a delay
            setTimeout(() => {
                finalizeUploadingFile(uploadId, false);
            }, 5000);
        } finally {
            // Reset uploading flag
            isUploading = false;
            
            // Clear file input value to allow re-uploading the same file
            $('#fileInput').val('');
            
            $dropZone.css({ opacity: '1', pointerEvents: 'auto' });
        }
    }

    // Handle dropped/selected files
    async function handleFiles(files: FileList): Promise<void> {
        if (files.length === 0) return;
        
        // Upload the first file (can be extended to handle multiple files)
        const file = files[0];
        await uploadFile(file);
    }

    // Query active indexers from blockchain
    async function queryActiveIndexers(): Promise<void> {
        try {
            const apiEndpoint = 'https://storage.datavault.space';
            const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/indexers/active`);
            
            if (!response.ok) {
                console.error('Failed to fetch active indexers:', response.status);
                return;
            }
            
            const data = await response.json();
            console.log('Active Indexers:', data);
        } catch (error) {
            console.error('Error querying active indexers:', error);
        }
    }

    // Start polling active indexers every 5 seconds
    function startIndexerPolling(): void {
        // Query immediately on start
        queryActiveIndexers();
        
        // Then query every 5 seconds
        setInterval(() => {
            queryActiveIndexers();
        }, 5000);
    }

    // Initialize dashboard
    export function init() {
        // Disconnect button
        $('#disconnectBtn').on('click', disconnectWallet);

        // Initialize drag and drop
        initDragAndDrop();

        // Start polling active indexers
        startIndexerPolling();

        // Initialize ECIES key cache if wallet is connected
        // This ensures the cache is ready before any file operations
        // Do this synchronously before setting up event listeners
        const initializeECIESKey = async () => {
            try {
                const walletAddress = sessionStorage.getItem('walletAddress');
                if (walletAddress) {
                    const keplr = getKeplr();
                    if (keplr) {
                        await keplr.enable(CHAIN_ID);
                        // Pre-initialize ECIES key material (will use cache if already exists)
                        await deriveECIESPrivateKey(walletAddress);
                        console.log('ECIES key material initialized on dashboard load');
                    }
                }
            } catch (error) {
                console.warn('Failed to initialize ECIES key on dashboard load:', error);
                // Don't throw - this is optional, will be initialized on first use
            }
        };
        
        // Start initialization immediately (don't await, but it will cache before first use)
        initializeECIESKey();

        // Check if user has wallet info in sessionStorage
        const walletInfo = sessionStorage.getItem('walletConnected');
        if (!walletInfo) {
            // If no wallet info, switch to wallet connection view
            import('./app').then(({ switchToWalletConnection }) => {
                switchToWalletConnection();
            });
            return;
        }
        
        // Update wallet address display
        const walletAddress = sessionStorage.getItem('walletAddress');
        if (walletAddress) {
            updateWalletAddressDisplay(walletAddress);
            
            // Fetch and display storage stats
            fetchStorageStats(walletAddress, showBuyStorageModal, showExtendStorageModal);
            
            // Fetch files automatically
            fetchFiles(walletAddress);
        }
    }
}
