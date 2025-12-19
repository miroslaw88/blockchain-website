// Share folder with other users via indexers

import { Dashboard } from './dashboard/index';
import { showToast } from './fetchFiles';

export interface ShareFolderResult {
    successCount: number;
    failureCount: number;
    successfulIndexers: string[];
    failedIndexers: Array<{ indexer: string; error: string }>;
}

/**
 * Share a folder with specified addresses via all active indexers
 * 
 * @param folderPath - The path of the folder to share (e.g., "/documents/myfolder/")
 * @param owner - The owner's wallet address
 * @param sharedWith - Array of wallet addresses to share with
 * @param expiresAt - Unix timestamp (seconds) when the share expires
 * @param encryptedFileKeys - Object mapping recipient addresses to their encrypted folder access keys
 * @returns Result with success/failure counts and details
 */
export async function shareFolder(
    folderPath: string,
    owner: string,
    sharedWith: string[],
    expiresAt: number,
    encryptedFileKeys: { [recipient: string]: string }
): Promise<ShareFolderResult> {
    // Get all active indexers
    const activeIndexers = Dashboard.getAllActiveIndexers();
    
    if (activeIndexers.length === 0) {
        throw new Error('No active indexers available. Please wait and try again.');
    }
    
    // Validate inputs
    if (sharedWith.length === 0) {
        throw new Error('At least one recipient address is required for sharing.');
    }
    
    if (!encryptedFileKeys || Object.keys(encryptedFileKeys).length === 0) {
        throw new Error('Encrypted folder access keys are required for sharing. Please ensure recipients have account keys.');
    }
    
    // Prepare the payload
    const payload: any = {
        share_type: 'private',
        shared_with: sharedWith,
        encrypted_file_keys: encryptedFileKeys,
        expires_at: expiresAt
    };
    
    // Debug: Log the payload structure (truncate keys for security)
    console.log('Share folder payload structure:', {
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
            const protocol = indexerAddress.includes('localhost') || 
                           /^\d+\.\d+\.\d+\.\d+/.test(indexerAddress) ||
                           indexerAddress.startsWith('127.0.0.1')
                ? 'http'
                : 'https';
            
            // Construct the URL
            const baseUrl = indexerAddress.startsWith('http://') || indexerAddress.startsWith('https://')
                ? indexerAddress
                : `${protocol}://${indexerAddress}`;
            
            // Encode the folder path for URL
            const encodedPath = encodeURIComponent(folderPath);
            const url = `${baseUrl}/api/indexer/v1/directories/${encodedPath}/share?owner=${owner}`;
            
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
            successfulIndexers.push(result.value.indexer);
        } else {
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

