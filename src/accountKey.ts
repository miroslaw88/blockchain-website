// Account key management - get symmetric key from blockchain subscription

import { decryptAccountKeyWithECIES } from './osd-blockchain-sdk';

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
    // Blockchain returns: {"encrypted_account_key": "hex_encoded_key_here"}
    const encryptedAccountKeyHex = data.encrypted_account_key || '';
    
    // Debug: Log the encrypted key details
    console.log('Encrypted key (hex):', encryptedAccountKeyHex);
    console.log('Encrypted key length (hex):', encryptedAccountKeyHex?.length || 0);
    console.log('Encrypted key type:', typeof encryptedAccountKeyHex);
    
    if (!encryptedAccountKeyHex || typeof encryptedAccountKeyHex !== 'string') {
        console.error('Invalid account key response:', data);
        throw new Error('Account key not found in response. Please ensure you have an active subscription and the key has been generated on the blockchain.');
    }
    
    // Validate hex format (basic check)
    if (encryptedAccountKeyHex.trim().length === 0) {
        throw new Error('Account key is empty. Please ensure the key has been properly generated on the blockchain.');
    }
    
    // Validate hex string format (must be even length and contain only hex characters)
    if (encryptedAccountKeyHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encryptedAccountKeyHex)) {
        throw new Error('Invalid hex format for account key. Please ensure the key has been properly generated on the blockchain.');
    }

    // Decrypt account key with owner's private key
    try {
        console.log('Decrypting account key, encrypted key length (hex):', encryptedAccountKeyHex.length);
        
        // Decrypt using ECIES (expects hex string)
        const accountKey = await decryptAccountKeyWithECIES(encryptedAccountKeyHex, walletAddress);
        
        if (!accountKey || accountKey.length !== 32) {
            throw new Error(`Invalid decrypted key: expected 32 bytes, got ${accountKey?.length || 0} bytes`);
        }
        
        // Cache the decrypted key
        accountKeyCache[walletAddress] = accountKey;
        
        return accountKey;
    } catch (error) {
        console.error('Error decrypting account key:', error);
        throw error;
    }
}

/**
 * Check if account ECIES public key exists on blockchain
 * 
 * @param walletAddress - The wallet address to check
 * @returns true if key exists, false if not found (404), throws on other errors
 */
export async function hasAccountKey(walletAddress: string): Promise<boolean> {
    try {
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(
            `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/ecies-public-key`
        );

        if (response.status === 404) {
            return false;
        }

        if (!response.ok) {
            throw new Error(`Failed to check ECIES public key: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        // Response structure: { "ecies_public_key": "04..." } (matches QueryECIESPublicKeyResponse protobuf)
        const eciesPublicKey = data.ecies_public_key || '';
        
        return !!eciesPublicKey;
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
 * Get ECIES public key from blockchain
 * 
 * @param walletAddress - The wallet address to get the ECIES public key for
 * @returns Hex-encoded ECIES public key (uncompressed format starting with 04)
 */
export async function getEncryptedAccountKey(walletAddress: string): Promise<string> {
    const apiEndpoint = 'https://storage.datavault.space';
    const response = await fetch(
        `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/ecies-public-key`
    );

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('ECIES public key not found');
        }
        throw new Error(`Failed to fetch ECIES public key: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Response structure: { "ecies_public_key": "04..." } (matches QueryECIESPublicKeyResponse protobuf)
    const eciesPublicKey = data.ecies_public_key || '';
    
    if (!eciesPublicKey) {
        throw new Error('ECIES public key not found in response');
    }
    
    return eciesPublicKey;
}

/**
 * Clear account key cache (useful for logout/disconnect)
 */
export function clearAccountKeyCache(): void {
    Object.keys(accountKeyCache).forEach(key => {
        delete accountKeyCache[key];
    });
}

