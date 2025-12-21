// File upload functionality

import { getKeplr, CHAIN_ID } from '../utils';
import { encryptFile, encryptFileKeyWithECIES, calculateMerkleRoot, hashFilename, genAesBundle } from '../osd-blockchain-sdk';
import { postFile } from '../postFile';
import { submitChunkMetadata } from '../submitChunkMetadata';
import { fetchFiles } from '../fetchFiles';
import { showUploadProgressToast, updateUploadingFileProgress, finalizeUploadingFile } from './uploadProgress';
import { generateDashManifest } from './generateDashManifest';

// Flag to prevent concurrent uploads
let isUploading = false;

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
    
    const uploadUrl = `https://storage.datavault.space/api/storage/files/upload`;
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

// Main upload file function
export async function uploadFile(file: File): Promise<void> {
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

        // Step 2.5: Generate MPEG-DASH manifest for video files (before encryption)
        let dashManifest: string | null = null;
        if (file.type.startsWith('video/')) {
            updateUploadingFileProgress(uploadId, 7, 'Generating MPEG-DASH manifest...');
            try {
                dashManifest = await generateDashManifest(file);
                console.log('MPEG-DASH manifest generated successfully');
                console.log('Generated MPEG-DASH Manifest:', dashManifest);
            } catch (error) {
                console.warn('Failed to generate MPEG-DASH manifest:', error);
                // Continue with upload even if manifest generation fails
            }
        }

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
            encryptedFileKeyBase64,
            dashManifest || undefined
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
            console.log('Preparing to upload chunks to:', `https://storage.datavault.space/api/storage/files/upload`);
            
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
export async function handleFiles(files: FileList): Promise<void> {
    if (files.length === 0) return;
    
    // Upload the first file (can be extended to handle multiple files)
    const file = files[0];
    await uploadFile(file);
}

