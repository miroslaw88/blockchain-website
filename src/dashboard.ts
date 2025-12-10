// Dashboard functionality
import { getKeplr, CHAIN_ID } from './utils';
import { fetchFiles } from './fetchFiles';
import { buyStorage } from './buyStorage';
import { postFile } from './postFile';

export namespace Dashboard {

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
            // Clear all wallet session data
            sessionStorage.removeItem('walletConnected');
            sessionStorage.removeItem('walletAddress');
            sessionStorage.removeItem('walletName');
            sessionStorage.removeItem('chainId');
            
            // Redirect back to home page
            window.location.href = 'index.html';
        }
    }

    // Handle menu item clicks
    function handleMenuClick(menuItem: HTMLElement): void {
        // Remove active class from all menu items
        document.querySelectorAll('.sidebar-menu-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to clicked item
        menuItem.closest('.sidebar-menu-item')?.classList.add('active');
    }


    // Initialize drag and drop
    function initDragAndDrop(): void {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput') as HTMLInputElement;
        
        if (!dropZone || !fileInput) return;

        // Click to browse
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Highlight drop zone when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            });
        });

        // Handle dropped files
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files) {
                handleFiles(dt.files);
            }
        });

        // Handle file input change
        fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files) {
                handleFiles(target.files);
            }
        });
    }

    // Encrypt file using wallet signature
    async function encryptFile(file: File, userAddress: string): Promise<Blob> {
        const keplr = getKeplr();
        if (!keplr || !keplr.signArbitrary) {
            throw new Error('Keplr signArbitrary not available');
        }

        // Read file as ArrayBuffer
        const fileData = await file.arrayBuffer();
        
        // Create a message to sign (using file hash for uniqueness)
        const fileHash = await calculateMerkleRoot(fileData);
        const messageToSign = `File encryption: ${fileHash}`;
        
        // Request signature from Keplr
        const signatureResult = await keplr.signArbitrary(CHAIN_ID, userAddress, messageToSign);
        
        // Derive encryption key from signature
        const signatureBytes = Uint8Array.from(atob(signatureResult.signature), c => c.charCodeAt(0));
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            signatureBytes.slice(0, 32), // Use first 32 bytes
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );
        
        // Derive AES key
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: new Uint8Array(0),
                iterations: 10000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-CBC', length: 256 },
            false,
            ['encrypt']
        );
        
        // Generate IV
        const iv = crypto.getRandomValues(new Uint8Array(16));
        
        // Encrypt file data
        const encryptedData = await crypto.subtle.encrypt(
            { name: 'AES-CBC', iv: iv },
            key,
            fileData
        );
        
        // Combine IV and encrypted data
        const combined = new Uint8Array(iv.length + encryptedData.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encryptedData), iv.length);
        
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
        const contentArea = document.getElementById('contentArea');
        if (!contentArea) return;

        contentArea.innerHTML = `
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
        `;

        // Handle form submission
        const form = document.getElementById('buyStorageForm') as HTMLFormElement;
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleBuyStorageSubmit();
            });
        }
    }

    // Handle buy storage form submission
    async function handleBuyStorageSubmit(): Promise<void> {
        const contentArea = document.getElementById('contentArea');
        const submitBtn = document.getElementById('submitBuyStorage') as HTMLButtonElement;
        const btnText = document.getElementById('buyStorageBtnText') as HTMLSpanElement;
        const spinner = document.getElementById('buyStorageSpinner') as HTMLSpanElement;

        if (!contentArea || !submitBtn) return;

        try {
            // Get form values
            const storageBytesInput = document.getElementById('storageBytes') as HTMLInputElement;
            const durationDaysInput = document.getElementById('durationDays') as HTMLInputElement;
            const paymentInput = document.getElementById('payment') as HTMLInputElement;

            if (!storageBytesInput || !durationDaysInput || !paymentInput) {
                throw new Error('Form inputs not found');
            }

            const storageBytes = parseInt(storageBytesInput.value);
            const durationDays = parseInt(durationDaysInput.value);
            const payment = paymentInput.value.trim();

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
            submitBtn.disabled = true;
            spinner.classList.remove('d-none');
            btnText.textContent = 'Processing...';

            // Execute buy storage transaction
            const txHash = await buyStorage(storageBytes, durationDays, payment);

            // Show success
            contentArea.innerHTML = `
                <div class="alert alert-success" role="alert">
                    <h5 class="alert-heading">Storage Purchase Successful!</h5>
                    <p><strong>Transaction Hash:</strong> <code>${txHash}</code></p>
                    <p><strong>Storage:</strong> ${(storageBytes / 1000000000).toFixed(2)} GB</p>
                    <p><strong>Duration:</strong> ${durationDays} days</p>
                    <p><strong>Payment:</strong> ${payment}</p>
                </div>
            `;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Buy storage failed';
            console.error('Buy storage error:', error);
            
            if (contentArea) {
                contentArea.innerHTML = `
                    <div class="alert alert-danger" role="alert">
                        <h5 class="alert-heading">Purchase Failed</h5>
                        <p>${errorMessage}</p>
                        <button class="btn btn-secondary mt-2" onclick="location.reload()">Try Again</button>
                    </div>
                `;
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                spinner.classList.add('d-none');
                btnText.textContent = 'Buy Storage';
            }
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
        const contentArea = document.getElementById('contentArea');
        const dropZone = document.getElementById('dropZone');
        
        if (!contentArea) return;

        // Show processing state
        if (dropZone) {
            dropZone.style.opacity = '0.5';
            dropZone.style.pointerEvents = 'none';
        }

        try {
            // Step 1: Connect to Keplr
            contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Connecting to wallet...</p></div>';
            const keplr = getKeplr();
            if (!keplr) {
                throw new Error('Keplr not available');
            }

            await keplr.enable(CHAIN_ID);
            const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
            const accounts = await offlineSigner.getAccounts();
            const userAddress = accounts[0].address;

            // Step 2: Encrypt file first
            contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Encrypting file...</p></div>';
            const encryptedFile = await encryptFile(file, userAddress);

            // Step 3: Calculate Merkle root from encrypted file data
            // The storage provider calculates the hash from the encrypted file it receives,
            // so we must match that by calculating from the encrypted data
            contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Calculating file hash...</p></div>';
            const encryptedData = await encryptedFile.arrayBuffer();
            const merkleRoot = await calculateMerkleRoot(encryptedData);

            // Step 4: Post file to blockchain (providers will be returned in the response)
            contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Posting transaction to blockchain...</p></div>';
            const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
            const postFileResult = await postFile(
                merkleRoot,
                encryptedFile.size,
                expirationTime,
                3,
                { name: file.name, content_type: file.type || 'application/octet-stream' }
            );

            // Step 5: Upload file to storage provider (use providers from transaction response)
            if (postFileResult.providers && postFileResult.providers.length > 0) {
                console.log('=== Storage Provider Upload ===');
                console.log('Providers received:', postFileResult.providers);
                console.log('Primary provider index:', postFileResult.primaryProviderIndex);
                
                contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary"></div><p class="mt-2">Uploading to storage provider...</p></div>';
                
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
                    { name: file.name, content_type: file.type || 'application/octet-stream' }
                );
                
                console.log('Upload to storage provider completed successfully');
            } else {
                console.warn('No storage providers assigned. File may be added to pending queue.');
                console.log('PostFileResult:', postFileResult);
            }

            // Success
            contentArea.innerHTML = `
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
            `;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'File upload failed';
            console.error('Upload error:', error);
            contentArea.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h5 class="alert-heading">Upload Failed</h5>
                    <p>${errorMessage}</p>
                </div>
            `;
        } finally {
            if (dropZone) {
                dropZone.style.opacity = '1';
                dropZone.style.pointerEvents = 'auto';
            }
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
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', disconnectWallet);
        }

        // Initialize drag and drop
        initDragAndDrop();

        // Buy Storage button
        const buyStorageBtn = document.getElementById('buyStorageBtn');
        if (buyStorageBtn) {
            buyStorageBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                handleMenuClick(buyStorageBtn);
                showBuyStorageForm();
            });
        }

        // View Files button
        const viewFilesBtn = document.getElementById('viewFilesBtn');
        if (viewFilesBtn) {
            viewFilesBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                handleMenuClick(viewFilesBtn);
                
                // Get wallet address from sessionStorage
                const walletAddress = sessionStorage.getItem('walletAddress');
                if (walletAddress) {
                    await fetchFiles(walletAddress);
                } else {
                    const contentArea = document.getElementById('contentArea');
                    if (contentArea) {
                        contentArea.innerHTML = `
                            <div class="alert alert-warning" role="alert">
                                <h5 class="alert-heading">Warning</h5>
                                <p>Wallet address not found. Please reconnect your wallet.</p>
                            </div>
                        `;
                    }
                }
            });
        }

        // Check if user came from wallet connection (has wallet info in sessionStorage)
        const walletInfo = sessionStorage.getItem('walletConnected');
        if (!walletInfo) {
            // If no wallet info, redirect back to home
            window.location.href = 'index.html';
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    Dashboard.init();
});

