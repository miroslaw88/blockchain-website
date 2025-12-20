// Share file with other users via indexers

import { Dashboard } from './dashboard/index';
import { showToast } from './fetchFiles';

export interface ShareFileResult {
    successCount: number;
    failureCount: number;
    successfulIndexers: string[];
    failedIndexers: Array<{ indexer: string; error: string }>;
}

/**
 * Share a file with specified addresses via all active indexers
 * 
 * @param merkleRoot - The merkle root of the file to share
 * @param owner - The owner's wallet address
 * @param sharedWith - Array of wallet addresses to share with
 * @param expiresAt - Unix timestamp (seconds) when the share expires
 * @param encryptedFileKeyForRecipient - File key encrypted with recipient's public key (base64)
 * @returns Result with success/failure counts and details
 */
export async function shareFile(
    merkleRoot: string,
    owner: string,
    sharedWith: string[],
    expiresAt: number,
    encryptedFileKeyForRecipient?: string
): Promise<ShareFileResult> {
    // Get all active indexers
    const activeIndexers = Dashboard.getAllActiveIndexers();
    
    if (activeIndexers.length === 0) {
        throw new Error('No active indexers available. Please wait and try again.');
    }
    
    // Prepare the payload
    const payload: any = {
        share_type: 'private',
        shared_with: sharedWith,
        expires_at: expiresAt
    };
    
    // Add encrypted file key if provided (encrypted with recipient's public key)
    // Structure as object mapping recipient addresses to their encrypted keys
    // The indexer expects encrypted_file_keys (plural) for each recipient in shared_with
    if (!encryptedFileKeyForRecipient || encryptedFileKeyForRecipient.trim() === '') {
        throw new Error('Encrypted file key is required for sharing. Please ensure the recipient has an account key.');
    }
    
    if (sharedWith.length === 0) {
        throw new Error('At least one recipient address is required for sharing.');
    }
    
    // Create encrypted_file_keys (plural) object mapping each recipient to their encrypted key
    // For now, we only support one recipient at a time in the UI, so we use the same key for all
    // In the future, if we support multiple recipients, we'd need to encrypt the key for each recipient separately
    payload.encrypted_file_keys = {};
    for (const recipient of sharedWith) {
        payload.encrypted_file_keys[recipient] = encryptedFileKeyForRecipient;
    }
    
    // Debug: Log the payload structure (truncate key for security)
    console.log('Share file payload structure:', {
        share_type: payload.share_type,
        shared_with: payload.shared_with,
        expires_at: payload.expires_at,
        encrypted_file_keys: Object.keys(payload.encrypted_file_keys).reduce((acc, key) => {
            acc[key] = payload.encrypted_file_keys[key].substring(0, 20) + '...';
            return acc;
        }, {} as any)
    });
    
    const results = await Promise.allSettled(
        activeIndexers.map(async (indexer) => {
            const indexerAddress = indexer.indexer_address;
            
            // Determine protocol (http or https) based on address
            // If it's localhost or an IP address, use http; otherwise use https
            const protocol = indexerAddress.includes('localhost') || 
                           /^\d+\.\d+\.\d+\.\d+/.test(indexerAddress) ||
                           indexerAddress.startsWith('127.0.0.1')
                ? 'http'
                : 'https';
            
            // Construct the URL
            const baseUrl = indexerAddress.startsWith('http://') || indexerAddress.startsWith('https://')
                ? indexerAddress
                : `${protocol}://${indexerAddress}`;
            
            const url = `${baseUrl}/api/indexer/v1/files/share`;
            
            // Add owner and merkle_root to payload
            const fullPayload = {
                owner: owner,
                merkle_root: merkleRoot,
                ...payload
            };
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify(fullPayload)
                    // Note: Not setting Content-Type header to avoid CORS preflight
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Indexer ${indexerAddress} returned ${response.status}: ${errorText}`);
                }
                
                return { indexer: indexerAddress, success: true };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                throw { indexer: indexerAddress, error: errorMessage };
            }
        })
    );
    
    // Process results
    const successfulIndexers: string[] = [];
    const failedIndexers: Array<{ indexer: string; error: string }> = [];
    
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            // Promise fulfilled means the request succeeded
            successfulIndexers.push(result.value.indexer);
        } else {
            // Handle rejected promises
            const rejectionValue = result.reason;
            if (rejectionValue && typeof rejectionValue === 'object' && 'indexer' in rejectionValue) {
                failedIndexers.push({
                    indexer: rejectionValue.indexer,
                    error: rejectionValue.error || 'Unknown error'
                });
            } else {
                failedIndexers.push({
                    indexer: activeIndexers[index]?.indexer_address || 'unknown',
                    error: rejectionValue?.message || rejectionValue?.toString() || 'Unknown error'
                });
            }
        }
    });
    
    return {
        successCount: successfulIndexers.length,
        failureCount: failedIndexers.length,
        successfulIndexers,
        failedIndexers
    };
}

