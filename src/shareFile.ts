// Share file with other users via indexers

import { Dashboard } from './dashboard';
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
    if (encryptedFileKeyForRecipient) {
        payload.encrypted_file_key = encryptedFileKeyForRecipient;
    }
    
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
            
            const url = `${baseUrl}/api/indexer/v1/files/${merkleRoot}/share?owner=${owner}`;
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify(payload)
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

