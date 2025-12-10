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


    // Encrypt file using AES-256-GCM with ECIES key derivation
    async function encryptFile(file: File, userAddress: string): Promise<Blob> {
        // Read file as ArrayBuffer
        const fileData = await file.arrayBuffer();
        
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
        
        // Generate IV (12 bytes for AES-GCM)
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Encrypt file data with AES-256-GCM (includes authentication tag)
        const encryptedData = await crypto.subtle.encrypt(
            { 
                name: 'AES-GCM',
                iv: iv,
                tagLength: 128 // 128-bit authentication tag
            },
            aesKey,
            fileData
        );
        
        // AES-GCM output format: encrypted data + authentication tag (16 bytes)
        // Combine IV (12 bytes) + encrypted data + tag (16 bytes)
        const encryptedArray = new Uint8Array(encryptedData);
        const combined = new Uint8Array(iv.length + encryptedArray.length);
        combined.set(iv, 0);
        combined.set(encryptedArray, iv.length);
        
        return new Blob([combined]);
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


    // Upload file to storage provider
    async function uploadToStorageProvider(
        providerAddress: string,
        encryptedFile: Blob,
        merkleRoot: string,
        owner: string,
        expirationTime: number,
        metadata: { name: string; content_type: string }
    ): Promise<void> {
        console.log('=== uploadToStorageProvider called ===');
        console.log('Provider address:', providerAddress);
        console.log('Encrypted file:', {
            size: encryptedFile.size,
            type: encryptedFile.type
        });
        console.log('Merkle root:', merkleRoot);
        console.log('Owner:', owner);
        console.log('Expiration time:', expirationTime);
        console.log('Metadata:', metadata);
        
        const formData = new FormData();
        formData.append('file', encryptedFile, 'encrypted.bin');
        formData.append('merkle_root', merkleRoot);
        formData.append('owner', owner);
        formData.append('expiration_time', expirationTime.toString());
        formData.append('metadata', JSON.stringify(metadata));
        
        console.log('FormData created with file and merkle_root');
        // Log FormData entries (FormData.entries() may not be typed in some TS versions)
        const formDataEntries: Array<{ key: string; value: string }> = [];
        try {
            // Use for...of loop to iterate FormData entries
            for (const [key, value] of formData as any) {
                formDataEntries.push({
                    key,
                    value: value instanceof File ? `File(${value.name}, ${value.size} bytes)` : String(value)
                });
            }
        } catch (e) {
            // Fallback if entries() is not available
            formDataEntries.push(
                { key: 'file', value: 'encrypted.bin' }, 
                { key: 'merkle_root', value: merkleRoot },
                { key: 'owner', value: owner },
                { key: 'expiration_time', value: expirationTime.toString() },
                { key: 'metadata', value: JSON.stringify(metadata) }
            );
        }
        console.log('FormData entries:', formDataEntries);

        const uploadUrl = `https://storage.datavault.space/api/v1/files/upload`;
        console.log('Upload URL:', uploadUrl);
        console.log('Sending fetch request...');

        try {
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData
            });

            const headersObj: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headersObj[key] = value;
            });
            console.log('Fetch response received:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                headers: headersObj
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Upload failed - Response text:', errorText);
                throw new Error(`Upload to storage provider failed: ${response.status} ${errorText}`);
            }
            
            const responseText = await response.text();
            console.log('Upload successful - Response:', responseText);
        } catch (error) {
            console.error('=== Upload Error ===');
            console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
            console.error('Error message:', error instanceof Error ? error.message : String(error));
            console.error('Full error:', error);
            throw error;
        }
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

        try {
            // Step 1: Connect to Keplr
            $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Connecting to wallet...</p></div>');
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
            $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Calculating file hash...</p></div>');
            const fileData = await file.arrayBuffer();
            const originalFileHash = await calculateMerkleRoot(fileData);

            // Step 3: Encrypt file
            $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Encrypting file...</p></div>');
            const encryptedFile = await encryptFile(file, userAddress);

            // Step 4: Calculate Merkle root from encrypted file data
            // The storage provider calculates the hash from the encrypted file it receives,
            // so we must match that by calculating from the encrypted data
            $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Calculating encrypted file hash...</p></div>');
            const encryptedData = await encryptedFile.arrayBuffer();
            const merkleRoot = await calculateMerkleRoot(encryptedData);

            // Step 5: Post file to blockchain (providers will be returned in the response)
            // Include original file hash in metadata for decryption
            $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Posting transaction to blockchain...</p></div>');
            const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
            const metadata = {
                name: file.name,
                content_type: file.type || 'application/octet-stream',
                original_file_hash: originalFileHash // Store original hash for decryption
            };
            const postFileResult = await postFile(
                merkleRoot,
                encryptedFile.size,
                expirationTime,
                3,
                metadata
            );

            // Step 5: Upload file to storage provider (use providers from transaction response)
            if (postFileResult.providers && postFileResult.providers.length > 0) {
                console.log('=== Storage Provider Upload ===');
                console.log('Providers received:', postFileResult.providers);
                console.log('Primary provider index:', postFileResult.primaryProviderIndex);
                
                $contentArea.html('<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Uploading to storage provider...</p></div>');
                
                // Use primary provider index if available, otherwise use first provider
                const providerIndex = postFileResult.primaryProviderIndex >= 0 
                    ? postFileResult.primaryProviderIndex 
                    : 0;
                const provider = postFileResult.providers[providerIndex];
                
                console.log('Selected provider index:', providerIndex);
                console.log('Selected provider:', provider);
                console.log('Provider address:', provider.providerAddress);
                console.log('Encrypted file size:', encryptedFile.size, 'bytes');
                console.log('Merkle root:', merkleRoot);
                console.log('Preparing to upload to:', `http://${provider.providerAddress}/api/v1/files/upload`);
                
                await uploadToStorageProvider(
                    provider.providerAddress, 
                    encryptedFile, 
                    merkleRoot, 
                    userAddress,
                    expirationTime,
                    metadata
                );
                
                console.log('Upload to storage provider completed successfully');
            } else {
                console.warn('No storage providers assigned. File may be added to pending queue.');
                console.log('PostFileResult:', postFileResult);
            }

            // Success
            $contentArea.html(`
                <div class="alert alert-success" role="alert">
                    <h5 class="alert-heading">Upload Successful!</h5>
                    <p><strong>File:</strong> ${file.name}</p>
                    <p><strong>Transaction Hash:</strong> <code>${postFileResult.transactionHash}</code></p>
                    <p><strong>Merkle Root:</strong> <code>${merkleRoot}</code></p>
                    ${postFileResult.providers.length > 0 
                        ? `<p><strong>Storage Providers:</strong> ${postFileResult.providers.length} assigned</p>`
                        : '<p class="text-warning mb-0"><strong>Note:</strong> No storage providers assigned yet. File may be in pending queue.</p>'
                    }
                </div>
            `);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'File upload failed';
            console.error('Upload error:', error);
            $contentArea.html(`
                <div class="alert alert-danger" role="alert">
                    <h5 class="alert-heading">Upload Failed</h5>
                    <p>${errorMessage}</p>
                </div>
            `);
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

// Initialize on page load
$(document).ready(() => {
    Dashboard.init();
});

