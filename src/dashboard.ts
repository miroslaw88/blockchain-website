// Dashboard functionality
import { getKeplr, CHAIN_ID, deriveECIESPrivateKey, eciesKeyMaterialCache } from './utils';
import { fetchFiles } from './fetchFiles';
import { buyStorage } from './buyStorage';
import { postFile } from './postFile';

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
            
            // Switch back to wallet connection view (no redirect)
            import('./app').then(({ switchToWalletConnection }) => {
                switchToWalletConnection();
            });
        }
    }

    // Handle menu item clicks
    function handleMenuClick(menuItem: HTMLElement): void {
        // Remove active class from all menu items
        $('.sidebar-menu-item').removeClass('active');
        
        // Add active class to clicked item
        $(menuItem).closest('.sidebar-menu-item').addClass('active');
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


    // Show buy storage form
    function showBuyStorageForm(): void {
        const $contentArea = $('#contentArea');
        if ($contentArea.length === 0) return;

        $contentArea.html(`
            <div class="card">
                <div class="card-header">
                    <h5 class="mb-0">Buy Storage</h5>
                </div>
                <div class="card-body">
                    <form id="buyStorageForm">
                        <div class="mb-3">
                            <label for="storageBytes" class="form-label">Storage Size (bytes)</label>
                            <input type="number" class="form-control" id="storageBytes" 
                                   placeholder="1000000000" value="1000000000" min="1" required>
                            <div class="form-text">Enter the amount of storage in bytes (e.g., 1000000000 = 1GB)</div>
                        </div>
                        <div class="mb-3">
                            <label for="durationDays" class="form-label">Duration (days)</label>
                            <input type="number" class="form-control" id="durationDays" 
                                   placeholder="30" value="30" min="1" required>
                            <div class="form-text">Enter the subscription duration in days</div>
                        </div>
                        <div class="mb-3">
                            <label for="payment" class="form-label">Payment Amount</label>
                            <input type="text" class="form-control" id="payment" 
                                   placeholder="0.1stake" value="0.1stake" required>
                            <div class="form-text">Enter payment amount (e.g., "0.1stake")</div>
                        </div>
                        <button type="submit" class="btn btn-primary" id="submitBuyStorage">
                            <span id="buyStorageBtnText">Buy Storage</span>
                            <span id="buyStorageSpinner" class="spinner-border spinner-border-sm ms-2 d-none" role="status"></span>
                        </button>
                    </form>
                </div>
            </div>
        `);

        // Handle form submission
        $('#buyStorageForm').on('submit', async (e) => {
            e.preventDefault();
            await handleBuyStorageSubmit();
        });
    }

    // Handle buy storage form submission
    async function handleBuyStorageSubmit(): Promise<void> {
        const $contentArea = $('#contentArea');
        const $submitBtn = $('#submitBuyStorage');
        const $btnText = $('#buyStorageBtnText');
        const $spinner = $('#buyStorageSpinner');

        if ($contentArea.length === 0 || $submitBtn.length === 0) return;

        try {
            // Get form values
            const storageBytes = parseInt($('#storageBytes').val() as string);
            const durationDays = parseInt($('#durationDays').val() as string);
            const payment = ($('#payment').val() as string).trim();

            // Validate inputs
            if (isNaN(storageBytes) || storageBytes <= 0) {
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
            $spinner.removeClass('d-none');
            $btnText.text('Processing...');

            // Execute buy storage transaction
            const txHash = await buyStorage(storageBytes, durationDays, payment);

            // Show success
            $contentArea.html(`
                <div class="alert alert-success" role="alert">
                    <h5 class="alert-heading">Storage Purchase Successful!</h5>
                    <p><strong>Transaction Hash:</strong> <code>${txHash}</code></p>
                    <p><strong>Storage:</strong> ${(storageBytes / 1000000000).toFixed(2)} GB</p>
                    <p><strong>Duration:</strong> ${durationDays} days</p>
                    <p><strong>Payment:</strong> ${payment}</p>
                </div>
            `);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Buy storage failed';
            console.error('Buy storage error:', error);
            
            $contentArea.html(`
                <div class="alert alert-danger" role="alert">
                    <h5 class="alert-heading">Purchase Failed</h5>
                    <p>${errorMessage}</p>
                    <button class="btn btn-secondary mt-2" onclick="location.reload()">Try Again</button>
                </div>
            `);
        } finally {
            $submitBtn.prop('disabled', false);
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


    // Helper function to add uploading file entry to files list
    function addUploadingFileEntry(file: File, uploadId: string): void {
        const $contentArea = $('#contentArea');
        const $filesRow = $contentArea.find('.row');
        
        // Check if files list is displayed
        if ($filesRow.length === 0) {
            // Files list not displayed, create it
            $contentArea.html(`
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h5 class="mb-0">Files</h5>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            ${createUploadingFileHTML(file, uploadId, 0)}
                        </div>
                    </div>
                </div>
            `);
        } else {
            // Add to existing files list
            $filesRow.append(createUploadingFileHTML(file, uploadId, 0));
        }
    }

    // Helper function to create HTML for uploading file entry
    function createUploadingFileHTML(file: File, uploadId: string, progress: number): string {
        const contentType = file.type || 'application/octet-stream';
        const fileSize = formatFileSize(file.size);
        
        // Use a simple file icon
        const fileIcon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
        
        return `
            <div class="col-md-3 col-sm-4 col-6 mb-4" id="uploading-${uploadId}" style="opacity: 0.6;">
                <div class="card h-100 file-thumbnail" style="transition: transform 0.2s;">
                    <div class="card-body text-center p-3">
                        <div class="file-icon mb-2" style="color: #6c757d;">
                            ${fileIcon}
                        </div>
                        <h6 class="card-title mb-1 text-truncate" style="font-size: 0.9rem;" title="${file.name}">${file.name}</h6>
                        <p class="text-muted small mb-1">${fileSize}</p>
                        <div class="mt-2">
                            <div class="progress" style="height: 20px;">
                                <div id="upload-progress-${uploadId}" class="progress-bar progress-bar-striped progress-bar-animated" 
                                     role="progressbar" style="width: ${progress}%" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                                    ${Math.round(progress)}%
                                </div>
                            </div>
                            <small class="text-muted d-block mt-1" id="upload-status-${uploadId}">Preparing...</small>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Helper function to update uploading file progress
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

    // Helper function to convert uploading file to regular file or remove it
    function finalizeUploadingFile(uploadId: string, success: boolean): void {
        const $uploadingEntry = $(`#uploading-${uploadId}`);
        
        if (success) {
            // Remove the uploading entry - files list will be refreshed
            $uploadingEntry.fadeOut(300, () => {
                $uploadingEntry.remove();
            });
        } else {
            // On error, remove the entry
            $uploadingEntry.fadeOut(300, () => {
                $uploadingEntry.remove();
            });
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
            // Add uploading file entry to files list
            addUploadingFileEntry(file, uploadId);
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
            const metadata = {
                name: hashedFileName, // Store hashed filename (like OSD system)
                original_name: file.name, // Store original filename for display/download
                content_type: file.type || 'application/octet-stream',
                original_file_hash: originalFileHash // Store original hash for decryption
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
                
                // Refresh files list to show the new file
                const walletAddress = sessionStorage.getItem('walletAddress');
                if (walletAddress) {
                    fetchFiles(walletAddress);
                }
            }, 500);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'File upload failed';
            console.error('Upload error:', error);
            
            // Update uploading entry to show error
            updateUploadingFileProgress(uploadId, 0, `Error: ${errorMessage}`);
            
            // Remove error entry after a delay
            setTimeout(() => {
                finalizeUploadingFile(uploadId, false);
            }, 3000);
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

    // Initialize dashboard
    export function init() {
        // Disconnect button
        $('#disconnectBtn').on('click', disconnectWallet);

        // Initialize drag and drop
        initDragAndDrop();

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

        // Buy Storage button
        $('#buyStorageBtn').on('click', async (e) => {
            e.preventDefault();
            handleMenuClick(e.currentTarget);
            showBuyStorageForm();
        });

        // View Files button
        $('#viewFilesBtn').on('click', async (e) => {
            e.preventDefault();
            handleMenuClick(e.currentTarget);
            
            // Get wallet address from sessionStorage
            const walletAddress = sessionStorage.getItem('walletAddress');
            if (walletAddress) {
                await fetchFiles(walletAddress);
            } else {
                $('#contentArea').html(`
                    <div class="alert alert-warning" role="alert">
                        <h5 class="alert-heading">Warning</h5>
                        <p>Wallet address not found. Please reconnect your wallet.</p>
                    </div>
                `);
            }
        });

        // Check if user has wallet info in sessionStorage
        const walletInfo = sessionStorage.getItem('walletConnected');
        if (!walletInfo) {
            // If no wallet info, switch to wallet connection view
            import('./app').then(({ switchToWalletConnection }) => {
                switchToWalletConnection();
            });
            return;
        }
    }
}
