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
        console.log('Old format: [12-byte IV][32-byte key][16-byte tag] = 60 bytes');
        console.log('New format: [32-byte nonce][12-byte IV][32-byte key][16-byte tag] = 92 bytes minimum');
        if (encryptedKeyBytes.length === 60) {
            console.log('Format detected: OLD (no nonce) - will need to regenerate');
            console.log('First 12 bytes (IV in old format):', Array.from(encryptedKeyBytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        } else if (encryptedKeyBytes.length >= 92) {
            console.log('Format detected: NEW (with nonce)');
            console.log('First 32 bytes (nonce):', Array.from(encryptedKeyBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        } else {
            console.log('Format detected: UNKNOWN - invalid length');
        }
    } catch (e) {
        console.error('Error decoding base64 key:', e);
    }

    // Decrypt account key with owner's private key
    try {
        console.log('Decrypting account key, encrypted key length:', encryptedAccountKeyBase64.length);
        const encryptedKeyBytes = Uint8Array.from(atob(encryptedAccountKeyBase64), c => c.charCodeAt(0));
        console.log('Encrypted key bytes length:', encryptedKeyBytes.length);
        console.log('Expected format: [32-byte nonce][12-byte IV][encrypted key + 16-byte tag] = minimum 60 bytes');
        
        // Check if the key is in the new format (with nonce)
        // Old format: [12-byte IV][32-byte key][16-byte tag] = 60 bytes
        // New format: [32-byte nonce][12-byte IV][32-byte key][16-byte tag] = 92 bytes minimum
        // So if it's exactly 60 bytes or less, it's the old format
        if (encryptedKeyBytes.length <= 60) {
            throw new Error(
                `Account key is encrypted with the old format (no nonce). ` +
                `The encrypted key is ${encryptedKeyBytes.length} bytes (old format), but the new format requires at least 92 bytes (32 nonce + 12 IV + 32 key + 16 tag). ` +
                `Please regenerate your account key using the "Generate Asymmetric Key" button to use the new encryption format.`
            );
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
        if (error instanceof Error && error.message.includes('old format')) {
            // Re-throw the user-friendly error about old format
            throw error;
        }
        if (error instanceof DOMException) {
            throw new Error(
                `Decryption failed: ${error.message}. ` +
                `This may indicate the account key was encrypted with the old format (no nonce). ` +
                `Please regenerate your account key using the "Generate Asymmetric Key" button.`
            );
        }
        throw error;
    }
}

/**
 * Check if account key exists on blockchain
 * 
 * @param walletAddress - The wallet address to check
 * @returns true if key exists, false if not found (404), throws on other errors
 */
export async function hasAccountKey(walletAddress: string): Promise<boolean> {
    try {
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(
            `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/key`
        );

        if (response.status === 404) {
            return false;
        }

        if (!response.ok) {
            throw new Error(`Failed to check account key: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const encryptedAccountKeyBase64 = data.encrypted_account_key || data.encryptedAccountKey || '';
        
        return !!encryptedAccountKeyBase64;
    } catch (error) {
        // If it's a 404, return false (key doesn't exist)
        if (error instanceof Error && error.message.includes('404')) {
            return false;
        }
        // For other errors, re-throw
        throw error;
    }
}

/**
 * Get encrypted account key from blockchain (without decrypting)
 * 
 * @param walletAddress - The wallet address to get the encrypted key for
 * @returns Base64 encoded encrypted account key
 */
export async function getEncryptedAccountKey(walletAddress: string): Promise<string> {
    const apiEndpoint = 'https://storage.datavault.space';
    const response = await fetch(
        `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/key`
    );

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Account key not found');
        }
        throw new Error(`Failed to fetch account key: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const encryptedAccountKeyBase64 = data.encrypted_account_key || data.encryptedAccountKey || '';
    
    if (!encryptedAccountKeyBase64) {
        throw new Error('Account key not found in response');
    }
    
    return encryptedAccountKeyBase64;
}

/**
 * Clear account key cache (useful for logout/disconnect)
 */
export function clearAccountKeyCache(): void {
    Object.keys(accountKeyCache).forEach(key => {
        delete accountKeyCache[key];
    });
}

