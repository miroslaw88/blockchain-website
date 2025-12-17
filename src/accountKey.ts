// Account key management - get symmetric key from blockchain subscription

import { decryptFileKeyWithECIES } from './osd-blockchain-sdk';

// Cache for decrypted account keys (per user address)
const accountKeyCache: { [address: string]: Uint8Array } = {};

/**
 * Get account's symmetric key from blockchain
 * The key is stored encrypted with the account owner's public key
 * 
 * @param walletAddress - The wallet address to get the account key for
 * @returns Decrypted account key (32 bytes)
 */
export async function getAccountKey(walletAddress: string): Promise<Uint8Array> {
    // Check cache first
    if (accountKeyCache[walletAddress]) {
        return accountKeyCache[walletAddress];
    }

    // Query blockchain for account's encrypted key
    // Endpoint: GET /osd-blockchain/osdblockchain/v1/account/{address}/key
    const apiEndpoint = 'https://storage.datavault.space';
    const response = await fetch(
        `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/key`
    );

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Account key not found. Please ensure you have an active subscription and the key has been generated on the blockchain.');
        }
        throw new Error(`Failed to fetch account key: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Debug: Log the full response
    console.log('=== Account Key Response from Blockchain ===');
    console.log('Full response:', JSON.stringify(data, null, 2));
    
    // Get encrypted account key from response
    // Blockchain returns: {"encrypted_account_key": "base64_encoded_key_here"}
    // Support both camelCase and snake_case for flexibility
    const encryptedAccountKeyBase64 = data.encrypted_account_key || 
                                       data.encryptedAccountKey || '';
    
    // Debug: Log the encrypted key details
    console.log('Encrypted key (base64):', encryptedAccountKeyBase64);
    console.log('Encrypted key length (base64):', encryptedAccountKeyBase64?.length || 0);
    console.log('Encrypted key type:', typeof encryptedAccountKeyBase64);
    
    if (!encryptedAccountKeyBase64 || typeof encryptedAccountKeyBase64 !== 'string') {
        console.error('Invalid account key response:', data);
        throw new Error('Account key not found in response. Please ensure you have an active subscription and the key has been generated on the blockchain.');
    }
    
    // Validate base64 format (basic check)
    if (encryptedAccountKeyBase64.trim().length === 0) {
        throw new Error('Account key is empty. Please ensure the key has been properly generated on the blockchain.');
    }
    
    // Debug: Decode and show binary length
    try {
        const encryptedKeyBytes = Uint8Array.from(atob(encryptedAccountKeyBase64), c => c.charCodeAt(0));
        console.log('Encrypted key (binary) length:', encryptedKeyBytes.length, 'bytes');
        console.log('Expected format: [12-byte IV][32-byte key][16-byte tag] = 60 bytes');
        console.log('First 12 bytes (IV):', Array.from(encryptedKeyBytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.log('Key format check:', encryptedKeyBytes.length >= 28 ? '✓ Valid length' : '✗ Too short');
    } catch (e) {
        console.error('Error decoding base64 key:', e);
    }

    // Decrypt account key with owner's private key
    try {
        console.log('Decrypting account key, encrypted key length:', encryptedAccountKeyBase64.length);
        const encryptedKeyBytes = Uint8Array.from(atob(encryptedAccountKeyBase64), c => c.charCodeAt(0));
        console.log('Encrypted key bytes length:', encryptedKeyBytes.length);
        
        if (encryptedKeyBytes.length < 12 + 16) {
            throw new Error(`Invalid encrypted key format: expected at least 28 bytes (12 IV + 16 tag), got ${encryptedKeyBytes.length} bytes`);
        }
        
        const accountKey = await decryptFileKeyWithECIES(encryptedKeyBytes, walletAddress);
        
        if (!accountKey || accountKey.length !== 32) {
            throw new Error(`Invalid decrypted key: expected 32 bytes, got ${accountKey?.length || 0} bytes`);
        }
        
        // Cache the decrypted key
        accountKeyCache[walletAddress] = accountKey;
        
        return accountKey;
    } catch (error) {
        console.error('Error decrypting account key:', error);
        if (error instanceof DOMException) {
            throw new Error(`Cryptographic operation failed: ${error.message}. This may indicate the encrypted key format from blockchain doesn't match the expected format.`);
        }
        throw error;
    }
}

/**
 * Clear account key cache (useful for logout/disconnect)
 */
export function clearAccountKeyCache(): void {
    Object.keys(accountKeyCache).forEach(key => {
        delete accountKeyCache[key];
    });
}

