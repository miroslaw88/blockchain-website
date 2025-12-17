// Account key management - get symmetric key from blockchain subscription

import { decryptFileKeyWithECIES } from './osd-blockchain-sdk';

// Cache for decrypted account keys (per user address)
const accountKeyCache: { [address: string]: Uint8Array } = {};

/**
 * Get account's symmetric key from blockchain subscription
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
    const apiEndpoint = 'https://storage.datavault.space';
    const response = await fetch(
        `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/storage`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch account key: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const subscription = data.subscription || {};
    
    // Get encrypted account key from subscription
    const encryptedAccountKeyBase64 = subscription.encryptedAccountKey || 
                                       subscription.encrypted_account_key || '';
    
    if (!encryptedAccountKeyBase64) {
        throw new Error('Account key not found. Please ensure you have an active subscription and the key has been generated on the blockchain.');
    }

    // Decrypt account key with owner's private key
    const encryptedKeyBytes = Uint8Array.from(atob(encryptedAccountKeyBase64), c => c.charCodeAt(0));
    const accountKey = await decryptFileKeyWithECIES(encryptedKeyBytes, walletAddress);

    // Cache the decrypted key
    accountKeyCache[walletAddress] = accountKey;

    return accountKey;
}

/**
 * Clear account key cache (useful for logout/disconnect)
 */
export function clearAccountKeyCache(): void {
    Object.keys(accountKeyCache).forEach(key => {
        delete accountKeyCache[key];
    });
}

