// Dashboard functionality
import { getKeplr, CHAIN_ID, deriveECIESPrivateKey, eciesKeyMaterialCache, updateWalletAddressDisplay } from './utils';
import { fetchFiles } from './fetchFiles';
import { buyStorage } from './buyStorage';
import { postFile } from './postFile';
import { fetchStorageStats } from './fetchStorageStats';
import { extendStorageDuration } from './extendStorage';
import { getExtendStorageModalTemplate, getBuyStorageModalTemplate, getECIESKeySetupModalTemplate } from './templates';
import { submitChunkMetadata } from './submitChunkMetadata';
import { encryptFile, encryptFileKeyWithECIES, calculateMerkleRoot, hashFilename, genAesBundle } from './osd-blockchain-sdk';
import { getAccountKey, hasAccountKey, getEncryptedAccountKey, clearAccountKeyCache } from './accountKey';
import { formatHexKey } from './utils';
import { generateAccountKey } from './generateAccountKey';
import { showToast } from './fetchFiles';

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
    
    // Store active indexers
    let activeIndexers: Array<{
        indexer_id: string;
        indexer_address: string;
        hash_prefix_start?: string;
        prefix_depth?: string;
        hash_prefix_end?: string;
        is_exact_prefix?: boolean;
        group_id?: string;
        file_count?: string;
        query_count?: string;
        registered_at?: string;
        last_updated?: string;
        is_active?: boolean;
    }> = [];
    
    // Get a random active indexer
    export function getRandomIndexer(): { indexer_address: string } | null {
        if (activeIndexers.length === 0) {
            return null;
        }
        const randomIndex = Math.floor(Math.random() * activeIndexers.length);
        return {
            indexer_address: activeIndexers[randomIndex].indexer_address
        };
    }
    
    // Get all active indexers
    export function getAllActiveIndexers(): Array<{ indexer_address: string }> {
        return activeIndexers.map(indexer => ({
            indexer_address: indexer.indexer_address
        }));
    }
    
    // Wait for an indexer to become available (polling every 500ms, max 60 seconds)
    export async function waitForIndexer(maxWaitTime: number = 60000): Promise<{ indexer_address: string }> {
        const startTime = Date.now();
        const checkInterval = 500; // Check every 500ms
        
        return new Promise((resolve, reject) => {
            const checkIndexer = () => {
                const indexer = getRandomIndexer();
                if (indexer) {
                    resolve(indexer);
                    return;
                }
                
                // Check if we've exceeded max wait time
                if (Date.now() - startTime >= maxWaitTime) {
                    reject(new Error('No active indexers available. Please wait and try again.'));
                    return;
                }
                
                // Check again after interval
                setTimeout(checkIndexer, checkInterval);
            };
            
            // Start checking
            checkIndexer();
        });
    }

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
            
            // Clear ECIES private key cache from osd-blockchain-sdk
            const { clearECIESPrivateKeyCache } = await import('./osd-blockchain-sdk');
            clearECIESPrivateKeyCache();
            
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
        metadata: { name: string; content_type: string },
        transactionHash: string
    ): Promise<void> {
        console.log(`=== Uploading chunk ${chunkIndex + 1}/${totalChunks} ===`);
        console.log('Provider address:', providerAddress);
        console.log('Chunk size:', encryptedChunk.size, 'bytes');
        console.log('Chunk merkle root:', chunkMerkleRoot);
        console.log('Combined merkle root:', combinedMerkleRoot);
        console.log('Owner:', owner);
        console.log('Transaction hash:', transactionHash);
        
        const formData = new FormData();
        formData.append('file', encryptedChunk, `chunk_${chunkIndex}.bin`);
        formData.append('merkle_root', chunkMerkleRoot); // Send individual chunk's merkle root
        formData.append('combined_merkle_root', combinedMerkleRoot); // Also send combined merkle root for file identification
        formData.append('owner', owner);
        formData.append('expiration_time', expirationTime.toString());
        formData.append('chunk_index', chunkIndex.toString());
        formData.append('total_chunks', totalChunks.toString());
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('transaction_hash', transactionHash);
        
        const uploadUrl = `https://storage.datavault.space/api/storage/v1/files/upload`;
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

            // Step 3: Generate per-file AES bundle and encrypt file
            updateUploadingFileProgress(uploadId, 10, 'Generating file encryption key...');
            
            // Generate unique AES bundle for this file (like Jackal)
            const fileAesBundle = await genAesBundle();
            
            updateUploadingFileProgress(uploadId, 15, 'Encrypting file...');
            
            // Encrypt file with per-file AES bundle
            const encryptedChunks = await encryptFile(file, fileAesBundle);
            
            // Encrypt file's AES bundle with owner's public key for storage in transaction
            const encryptedFileKeyBase64 = await encryptFileKeyWithECIES(fileAesBundle, userAddress);

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
                metadata,
                encryptedFileKeyBase64
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
                console.log('Preparing to upload chunks to:', `https://storage.datavault.space/api/storage/v1/files/upload`);
                
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
                        metadata,
                        postFileResult.transactionHash // Pass transaction hash
                    );
                }
                
                console.log('Upload to storage provider completed successfully');
                updateUploadingFileProgress(uploadId, 90, 'Submitting chunk metadata to indexers...');
                
                // Step 8: Submit chunk metadata to indexers
                try {
                    // Build chunks array with index, hash (merkle root), and size
                    const chunks = encryptedChunks.map((chunk, index) => ({
                        index: index,
                        hash: chunkMerkleRoots[index],
                        size: chunk.size
                    }));
                    
                    console.log('Submitting chunk metadata:', {
                        owner: userAddress,
                        merkleRoot: combinedMerkleRoot,
                        encryptedFileKey: encryptedFileKeyBase64.substring(0, 50) + '...',
                        chunks: chunks
                    });
                    
                    const chunkMetadataResult = await submitChunkMetadata(
                        userAddress,
                        combinedMerkleRoot,
                        chunks,
                        encryptedFileKeyBase64
                    );
                    
                    console.log(`Chunk metadata submitted: ${chunkMetadataResult.successCount} success(es), ${chunkMetadataResult.failureCount} failure(s)`);
                    console.log('Successful indexers:', chunkMetadataResult.indexers.map(i => i.indexer_id));
                    
                    if (chunkMetadataResult.successCount > 0) {
                        updateUploadingFileProgress(uploadId, 95, `Finalizing... (${chunkMetadataResult.successCount} indexer(s) updated)`);
                    } else {
                        updateUploadingFileProgress(uploadId, 95, 'Finalizing... (chunk metadata submission failed)');
                    }
                } catch (error) {
                    console.error('Failed to submit chunk metadata:', error);
                    // Don't fail the entire upload if chunk metadata submission fails
                    // The file is already uploaded to the storage provider
                    updateUploadingFileProgress(uploadId, 95, 'Finalizing... (chunk metadata submission failed)');
                }
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
            
            // Store active indexers
            if (data.indexers && Array.isArray(data.indexers)) {
                activeIndexers = data.indexers.filter((indexer: any) => indexer.is_active === true);
            }
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

    // Check if account has a key and update header display
    async function checkAndUpdateAccountKeyStatus(walletAddress: string): Promise<void> {
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

    // Flag to prevent concurrent uploads
    let isUploadingECIESKey = false;

    // Check ECIES key and show setup modal if needed
    async function checkECIESKeyAndShowModal(walletAddress: string): Promise<void> {
        try {
            const { hasAccountKey } = await import('./accountKey');
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

        // Set up button handler
        $('#generateECIESKeyBtn').off('click').on('click', async () => {
            await handleECIESKeyGenerationFromModal(walletAddress);
        });

        // Show modal (non-dismissible: backdrop static, keyboard disabled)
        const modal = new (window as any).bootstrap.Modal(modalElement, {
            backdrop: 'static',
            keyboard: false
        });
        modal.show();
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
            const { uploadECIESPublicKey } = await import('./generateAccountKey');
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
    async function handleDeleteAccountKey(): Promise<void> {
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
            const { deleteECIESPublicKey } = await import('./generateAccountKey');
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
    async function handleGenerateAccountKey(): Promise<void> {
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
            const { hasAccountKey } = await import('./accountKey');
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
            const { uploadECIESPublicKey } = await import('./generateAccountKey');
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

    // Initialize dashboard
    export function init() {
        // Disconnect button
        $('#disconnectBtn').on('click', disconnectWallet);

        // Generate account key button (delegated event handler for dynamically added button)
        // Remove any existing handlers first to prevent duplicates
        $(document).off('click', '#generateKeyBtn', handleGenerateAccountKey);
        $(document).on('click', '#generateKeyBtn', handleGenerateAccountKey);
        
        // Delete account key button (delegated event handler for dynamically added button)
        $(document).off('click', '#deleteKeyBtn', handleDeleteAccountKey);
        $(document).on('click', '#deleteKeyBtn', handleDeleteAccountKey);

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
            
            // Check if ECIES key exists, show setup modal if not
            checkECIESKeyAndShowModal(walletAddress);
            
            // Check account key status and update header
            checkAndUpdateAccountKeyStatus(walletAddress);
            
            // Fetch and display storage stats
            fetchStorageStats(walletAddress, showBuyStorageModal, showExtendStorageModal);
            
            // Fetch files automatically
            fetchFiles(walletAddress);
        }
    }
}
