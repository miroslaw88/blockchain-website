/**
 * OSD Blockchain SDK
 * 
 * A reusable library for encrypting/decrypting files and posting blockchain transactions
 * for the OSD Blockchain storage system.
 * 
 * Dependencies:
 * - @cosmjs/stargate
 * - @cosmjs/proto-signing
 * - Keplr wallet extension
 * 
 * Usage:
 * ```typescript
 * import { encryptFile, decryptFile, postFileToBlockchain, calculateMerkleRoot, hashFilename } from './osd-blockchain-sdk';
 * ```
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface KeplrWindow extends Window {
    keplr?: {
        enable: (chainId: string) => Promise<void>;
        disable: (chainId: string) => Promise<void>;
        getOfflineSigner: (chainId: string) => any;
        getKey?: (chainId: string) => Promise<{
            name: string;
            algo: string;
            pubKey: Uint8Array;
            address: Uint8Array;
            bech32Address: string;
        }>;
        signArbitrary?: (chainId: string, signer: string, data: string | Uint8Array) => Promise<{
            pub_key: {
                type: string;
                value: string;
            };
            signature: string;
        }>;
    };
}

export interface StorageProvider {
    providerId: string;
    providerAddress: string;
    registeredAt?: number;
    lastUpdated?: number;
    isActive?: boolean;
    totalCapacityBytes?: number;
    usedCapacityBytes?: number;
}

export interface PostFileResult {
    transactionHash: string;
    providers: StorageProvider[];
    primaryProviderIndex: number;
}

export interface FileMetadata {
    name: string;
    original_name?: string;
    content_type: string;
    original_file_hash?: string;
}

// ============================================================================
// Configuration
// ============================================================================

export const CHAIN_ID = 'osdblockchain';
export const ENCRYPTION_CHUNK_SIZE = 32 * 1024 * 1024; // 32MB chunks (like OSD system)
export const PBKDF2_ITERATIONS = 10000;
export const AES_TAG_LENGTH = 128; // 128-bit authentication tag

// ============================================================================
// Keplr Utilities
// ============================================================================

/**
 * Get Keplr wallet instance
 */
export function getKeplr(): KeplrWindow['keplr'] {
    const window = globalThis as unknown as KeplrWindow;
    return window.keplr;
}

// ============================================================================
// Private Key Management (Mnemonic-based, like Jackal)
// ============================================================================

// Cache for private keys (per user address) - derived from mnemonic
const privateKeyCache: { [address: string]: string } = {}; // hex string

/**
 * Get the actual secp256k1 private key from mnemonic (like Jackal)
 * This matches the public key stored on the blockchain
 * 
 * @param mnemonic - The mnemonic phrase (12/24 words)
 * @param addressPrefix - Address prefix (default: 'cosmos')
 * @param hdPath - HD derivation path (default: "m/44'/118'/0'/0/0" for Cosmos)
 * @returns Private key as hex string (64 characters, 32 bytes)
 */
export async function getPrivateKeyFromMnemonic(
    mnemonic: string,
    addressPrefix: string = 'cosmos',
    hdPath?: string
): Promise<string> {
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
    const { stringToPath } = await import('@cosmjs/crypto');
    
    // Default HD path for Cosmos (m/44'/118'/0'/0/0)
    const defaultHdPath = stringToPath("m/44'/118'/0'/0/0");
    const hdPathToUse = hdPath ? stringToPath(hdPath) : defaultHdPath;
    
    // Create wallet from mnemonic
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
        prefix: addressPrefix,
        hdPaths: [hdPathToUse],
    });
    
    // Get the account (first account from HD path)
    const accounts = await wallet.getAccounts();
    if (accounts.length === 0) {
        throw new Error('No accounts found from mnemonic');
    }
    
    // Use @cosmjs/crypto to derive the keypair directly from the mnemonic
    // This matches what DirectSecp256k1HdWallet does internally
    const { EnglishMnemonic } = await import('@cosmjs/crypto');
    const { Bip39 } = await import('@cosmjs/crypto');
    const { Slip10, Slip10Curve } = await import('@cosmjs/crypto');
    
    // Convert mnemonic to seed
    const mnemonicChecked = new EnglishMnemonic(mnemonic);
    const seed = await Bip39.mnemonicToSeed(mnemonicChecked);
    
    // Derive keypair from seed using HD path (SLIP-10 derivation)
    // This is the same method DirectSecp256k1HdWallet uses internally
    const keypair = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPathToUse);
    
    // Return private key as hex string (32 bytes = 64 hex characters)
    return uint8ArrayToHex(keypair.privkey);
}

/**
 * Get private key for an address using Keplr's getOfflineSigner
 * Uses Keplr's signing to derive key material that can work with ECIES
 * 
 * Note: This is a workaround - Keplr doesn't expose private keys directly.
 * We use the offline signer to sign a deterministic message and derive key material.
 * However, this derived key may not match the actual public key on the blockchain.
 * 
 * @param address - The wallet address (bech32 format)
 * @param chainId - Chain ID (defaults to CHAIN_ID)
 * @returns Private key as hex string (derived from Keplr signing)
 */
async function getPrivateKeyFromKeplrSigner(
    address: string,
    chainId: string = CHAIN_ID
): Promise<string> {
    const keplr = getKeplr();
    if (!keplr) {
        throw new Error('Keplr not available');
    }
    
    await keplr.enable(chainId);
    
    // Get the public key from Keplr to verify we have the right account
    if (!keplr.getKey) {
        throw new Error('Keplr getKey not available');
    }
    const key = await keplr.getKey(chainId);
    if (key.bech32Address !== address) {
        throw new Error(`Address mismatch: expected ${address}, got ${key.bech32Address}`);
    }
    
    // Use Keplr's offline signer to sign a deterministic message
    // This proves we have access to the private key, but we can't extract it directly
    const offlineSigner = keplr.getOfflineSigner(chainId);
    const accounts = await offlineSigner.getAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No accounts found from Keplr');
    }
    
    // Get the account that matches the address
    const account = accounts.find((acc: any) => acc.address === address);
    if (!account) {
        throw new Error(`Account not found for address ${address}`);
    }
    
    // Use signArbitrary to get a signature from Keplr
    // This signature is created with the actual private key, but we can't extract it
    // Instead, we'll use the signature to derive key material
    // However, this won't match the actual private key for ECIES decryption
    
    // Try to use the offline signer's signAmino or signDirect methods
    // to sign a message and extract key material from the signature
    const { makeSignDoc } = await import('@cosmjs/amino');
    
    // Create a deterministic sign doc for key derivation
    const signDoc = makeSignDoc(
        [],
        { amount: [], gas: '0' },
        chainId,
        '',
        0,
        0
    );
    
    try {
        // Sign the document using the offline signer
        // This will use Keplr's actual private key to sign
        const signResponse = await offlineSigner.signAmino(address, signDoc);
        
        // Extract signature bytes
        const signatureBytes = Uint8Array.from(
            atob(signResponse.signature.signature),
            c => c.charCodeAt(0)
        );
        
        // Derive private key material from signature
        // Note: This is a workaround - the derived key won't match the actual private key
        // but we'll try to use it for ECIES decryption
        const privateKeyHash = await crypto.subtle.digest('SHA-256', signatureBytes);
        const privateKeyMaterial = new Uint8Array(privateKeyHash).slice(0, 32);
        
        // Convert to hex string
        const privateKeyHex = uint8ArrayToHex(privateKeyMaterial);
        
        // Verify this derived key produces a public key that matches
        // If it doesn't match, we can't use it for ECIES
        const { getPublicKey } = await import('@noble/secp256k1');
        const derivedPublicKey = getPublicKey(privateKeyMaterial, true);
        const blockchainPublicKey = await getAccountPublicKey(address);
        
        // Check if they match
        if (derivedPublicKey.length === blockchainPublicKey.length) {
            let matches = true;
            for (let i = 0; i < derivedPublicKey.length; i++) {
                if (derivedPublicKey[i] !== blockchainPublicKey[i]) {
                    matches = false;
                    break;
                }
            }
            
            if (matches) {
                // Success! The derived key matches the public key
                return privateKeyHex;
            }
        }
        
        // The derived key doesn't match - we can't use it for ECIES
        throw new Error('Cannot derive matching private key from Keplr signer. The derived key does not match the blockchain public key.');
        
    } catch (error) {
        console.error('Error deriving private key from Keplr signer:', error);
        throw new Error(`Failed to derive private key from Keplr: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get private key for an address (from cache, Keplr signer, or derive from mnemonic)
 * 
 * @param address - The wallet address (bech32 format)
 * @param mnemonic - Optional mnemonic phrase
 * @param chainId - Chain ID for Keplr (defaults to CHAIN_ID)
 * @returns Private key as hex string
 */
export async function getPrivateKeyForAddress(
    address: string,
    mnemonic?: string,
    chainId: string = CHAIN_ID
): Promise<string> {
    // Check cache first
    if (privateKeyCache[address]) {
        return privateKeyCache[address];
    }
    
    // If mnemonic provided, use it
    if (mnemonic) {
        const privateKeyHex = await getPrivateKeyFromMnemonic(mnemonic);
        privateKeyCache[address] = privateKeyHex;
        return privateKeyHex;
    }
    
    // Try to get from sessionStorage
    const storedMnemonic = sessionStorage.getItem(`mnemonic_${address}`);
    if (storedMnemonic) {
        const privateKeyHex = await getPrivateKeyFromMnemonic(storedMnemonic);
        privateKeyCache[address] = privateKeyHex;
        return privateKeyHex;
    }
    
    // Try to get from Keplr's offline signer
    try {
        return await getPrivateKeyFromKeplrSigner(address, chainId);
    } catch (error) {
        // If Keplr approach fails, throw the original error
        throw new Error(`Mnemonic required for address ${address}. Please provide mnemonic or set it in sessionStorage.`);
    }
}

/**
 * Set mnemonic for an address (stores in sessionStorage)
 * 
 * @param address - The wallet address
 * @param mnemonic - The mnemonic phrase
 */
export function setMnemonicForAddress(address: string, mnemonic: string): void {
    sessionStorage.setItem(`mnemonic_${address}`, mnemonic);
    // Clear private key cache to force re-derivation
    delete privateKeyCache[address];
}

/**
 * Clear private key cache (useful for logout/disconnect)
 */
export function clearPrivateKeyCache(): void {
    Object.keys(privateKeyCache).forEach(key => {
        delete privateKeyCache[key];
    });
    // Also clear ECIES private key cache
    clearECIESPrivateKeyCache();
}

// Cache for public keys (per address)
const publicKeyCache: { [address: string]: Uint8Array } = {};

// Cache for ECIES private keys (per address) - in-memory only for security
const eciesPrivateKeyCache: { [address: string]: string } = {};

// Cache for "Initiate Storage Session" signatures (per address) - shared with utils.ts
// This allows us to reuse the signature instead of requesting it multiple times
const storageSessionSignatureCache: { [address: string]: string } = {};

/**
 * Get or request "Initiate Storage Session" signature
 * This signature is shared across the app for deriving ECIES keys
 * 
 * @param walletAddress - Wallet address (bech32 format)
 * @returns Signature as base64 string
 */
export async function getStorageSessionSignature(walletAddress: string): Promise<string> {
    // Check cache first
    if (storageSessionSignatureCache[walletAddress]) {
        console.log('Using cached "Initiate Storage Session" signature for', walletAddress);
        return storageSessionSignatureCache[walletAddress];
    }

    const keplr = getKeplr();
    if (!keplr || !keplr.signArbitrary) {
        throw new Error('Keplr signArbitrary not available');
    }

    // Request "Initiate Storage Session" signature
    const signatureMessage = 'Initiate Storage Session';
    console.log('Requesting Keplr signature for "Initiate Storage Session"...');
    const signatureResult = await keplr.signArbitrary(CHAIN_ID, walletAddress, signatureMessage);
    
    // Cache the signature
    storageSessionSignatureCache[walletAddress] = signatureResult.signature;
    console.log('"Initiate Storage Session" signature cached for', walletAddress);
    
    return signatureResult.signature;
}

/**
 * Derive ECIES private key deterministically from wallet signature
 * Uses Keplr's signArbitrary to sign "Initiate Storage Session" message, then derives private key from signature
 * Same wallet will always produce the same ECIES keypair
 * Reuses the same signature message used elsewhere in the app
 * 
 * @param walletAddress - Wallet address (bech32 format)
 * @returns Private key as hex string (32 bytes)
 */
async function deriveECIESPrivateKeyFromWallet(walletAddress: string): Promise<string> {
    // Check cache first - if we've already derived this key, use cached version
    if (eciesPrivateKeyCache[walletAddress]) {
        console.log('Using cached ECIES private key for', walletAddress);
        return eciesPrivateKeyCache[walletAddress];
    }

    // Get the "Initiate Storage Session" signature (will use cache if available)
    const signatureBase64 = await getStorageSessionSignature(walletAddress);
    
    // Derive private key from signature hash
    // Use SHA-256 to get a 32-byte private key
    const signatureBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    const privateKeyHash = await crypto.subtle.digest('SHA-256', signatureBytes);
    const privateKeyBytes = new Uint8Array(privateKeyHash);
    
    // Ensure we have exactly 32 bytes
    if (privateKeyBytes.length !== 32) {
        throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKeyBytes.length}`);
    }
    
    const privateKeyHex = uint8ArrayToHex(privateKeyBytes);
    
    // Derive public key from private key to verify it matches blockchain
    const { getPublicKey } = await import('@noble/secp256k1');
    const derivedPublicKey = getPublicKey(privateKeyBytes, false); // false = uncompressed
    const derivedPublicKeyHex = uint8ArrayToHex(derivedPublicKey);
    console.log('Derived ECIES public key from private key:', derivedPublicKeyHex);
    
    // Cache the derived private key (in-memory only, not localStorage)
    eciesPrivateKeyCache[walletAddress] = privateKeyHex;
    console.log('ECIES private key derived and cached for', walletAddress);
    
    return privateKeyHex;
}

/**
 * Clear ECIES private key cache (call when wallet disconnects)
 */
export function clearECIESPrivateKeyCache(): void {
    Object.keys(eciesPrivateKeyCache).forEach(key => {
        delete eciesPrivateKeyCache[key];
    });
    // Also clear signature cache
    Object.keys(storageSessionSignatureCache).forEach(key => {
        delete storageSessionSignatureCache[key];
    });
    console.log('ECIES private key cache and signature cache cleared');
}

/**
 * Set storage session signature (called from utils.ts when signature is obtained)
 * This allows sharing the signature between modules
 */
export function setStorageSessionSignature(walletAddress: string, signature: string): void {
    storageSessionSignatureCache[walletAddress] = signature;
    console.log('Storage session signature set for', walletAddress);
}

/**
 * Generate/derive ECIES keypair deterministically from wallet
 * Same wallet will always produce the same keypair
 * 
 * @param walletAddress - Wallet address (bech32 format)
 * @returns Object with privateKeyHex (hex string) and publicKeyHex (hex string, uncompressed format starting with 04)
 */
export async function generateECIESKeypair(walletAddress: string): Promise<{ privateKeyHex: string; publicKeyHex: string }> {
    const { getPublicKey } = await import('@noble/secp256k1');
    
    // Derive private key deterministically from wallet signature
    const privateKeyHex = await deriveECIESPrivateKeyFromWallet(walletAddress);
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    
    // Derive public key from private key (uncompressed format, 65 bytes starting with 04)
    const publicKeyBytes = getPublicKey(privateKeyBytes, false); // false = uncompressed
    
    // Convert to hex string
    const publicKeyHex = uint8ArrayToHex(publicKeyBytes);
    
    return { privateKeyHex, publicKeyHex };
}

/**
 * Get account ECIES public key from blockchain
 * Queries the ECIES public key endpoint: GET /osd-blockchain/osdblockchain/v1/account/{address}/ecies-public-key
 * 
 * @param address - Account address (bech32 format)
 * @returns Public key as Uint8Array (uncompressed secp256k1 format, 65 bytes starting with 04)
 */
async function getAccountPublicKey(address: string): Promise<Uint8Array> {
    // Check cache first
    if (publicKeyCache[address]) {
        return publicKeyCache[address];
    }

    try {
        const apiEndpoint = 'https://storage.datavault.space';
        
        // Query the ECIES public key endpoint
        // Expected response: { "ecies_public_key": "04..." }
        const response = await fetch(
            `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${address}/ecies-public-key`
        );

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`ECIES public key not found for address ${address}. Please upload your ECIES public key first.`);
            }
            throw new Error(`Failed to fetch account ECIES public key: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Log the raw response from blockchain
        console.log('=== ECIES Public Key Response from Blockchain ===');
        console.log('Full response data:', JSON.stringify(data, null, 2));
        
        // Extract ECIES public key from response (hex string, uncompressed format starting with 04)
        // Response structure: { "ecies_public_key": "04..." } (matches QueryECIESPublicKeyResponse protobuf)
        const pubKeyHex = data.ecies_public_key || '';
        
        console.log('Extracted public key (hex):', pubKeyHex);
        console.log('Public key hex length:', pubKeyHex.length);
        console.log('Public key (first 20 chars):', pubKeyHex.substring(0, 20));
        console.log('Public key (last 20 chars):', pubKeyHex.substring(pubKeyHex.length - 20));
        
        if (!pubKeyHex) {
            throw new Error('ECIES public key not found in response');
        }

        // Convert hex string to Uint8Array
        const pubKeyBytes = hexToUint8Array(pubKeyHex);
        
        console.log('Public key bytes length:', pubKeyBytes.length);
        console.log('Public key bytes (first 10):', Array.from(pubKeyBytes.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        // Validate format (should be 65 bytes, starting with 04 for uncompressed)
        if (pubKeyBytes.length !== 65 || pubKeyBytes[0] !== 0x04) {
            throw new Error(`Invalid ECIES public key format: expected 65 bytes starting with 04, got ${pubKeyBytes.length} bytes starting with ${pubKeyBytes[0]?.toString(16)}`);
        }
        
        // Cache the public key
        publicKeyCache[address] = pubKeyBytes;
        
        return pubKeyBytes;
    } catch (error) {
        console.error('Error fetching ECIES public key from blockchain:', error);
        throw new Error(`Failed to get recipient's ECIES public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Convert Uint8Array to hex string
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

/**
 * Encrypt value using arbitrary ECIES public key (like Jackal)
 * 
 * @param pubKey - Public key as hex string or Uint8Array
 * @param toEncrypt - Value to encrypt (ArrayBuffer or Uint8Array)
 * @returns Encrypted value as hex string
 */
export async function eciesEncryptWithPubKey(
    pubKey: string | Uint8Array,
    toEncrypt: ArrayBuffer | Uint8Array
): Promise<string> {
    const { encrypt } = await import('eciesjs');
    
    // Convert public key to hex if it's Uint8Array
    const pubKeyHex = typeof pubKey === 'string' ? pubKey : uint8ArrayToHex(pubKey);
    
    // Convert data to Uint8Array
    const data = toEncrypt instanceof Uint8Array 
        ? toEncrypt 
        : new Uint8Array(toEncrypt);
    
    // Encrypt with ECIES (returns Buffer or Uint8Array, convert to hex)
    const encrypted = encrypt(pubKeyHex, data);
    // Handle both Buffer (Node.js) and Uint8Array (browser)
    const encryptedArray = encrypted instanceof Uint8Array 
        ? encrypted 
        : new Uint8Array(encrypted);
    return uint8ArrayToHex(encryptedArray);
}

/**
 * Decrypt value using ECIES private key (like Jackal)
 * 
 * @param privateKeyHex - Private key as hex string
 * @param toDecrypt - Value to decrypt (hex string or Uint8Array)
 * @returns Decrypted value as Uint8Array
 */
export async function eciesDecryptWithPrivateKey(
    privateKeyHex: string,
    toDecrypt: string | Uint8Array
): Promise<Uint8Array> {
    const { decrypt } = await import('eciesjs');
    
    // Convert encrypted data to Uint8Array if it's a hex string
    const encrypted = typeof toDecrypt === 'string' 
        ? hexToUint8Array(toDecrypt)
        : toDecrypt;
    
    // Decrypt with ECIES (returns Buffer or Uint8Array, convert to Uint8Array)
    const decrypted = decrypt(privateKeyHex, encrypted);
    // Handle both Buffer (Node.js) and Uint8Array (browser)
    return decrypted instanceof Uint8Array 
        ? decrypted 
        : new Uint8Array(decrypted);
}

/**
 * Encrypt a symmetric key (AES bundle) with recipient's public key using ECIES
 * This is a convenience wrapper that uses aesToString internally
 * 
 * @param aesBundle - The AES bundle to encrypt
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @returns Encrypted AES bundle as pipe-delimited hex string: encryptedIV|encryptedKey
 */
export async function encryptFileKeyWithECIES(
    aesBundle: IAesBundle,
    recipientAddress: string
): Promise<string> {
    // Get recipient's public key from blockchain
    const recipientPubKeyBytes = await getAccountPublicKey(recipientAddress);
    
    // Encrypt AES bundle using ECIES (returns hex string with pipe delimiter)
    return await aesToString(recipientPubKeyBytes, aesBundle);
}

/**
 * Get ECIES private key for an address (derived deterministically from wallet)
 * Same wallet always produces the same private key
 * 
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @returns Private key as hex string (derived on-demand from wallet signature)
 */
async function getECIESPrivateKeyForAddress(recipientAddress: string): Promise<string> {
    // Derive private key deterministically from wallet signature
    // This will always produce the same key for the same wallet
    try {
        const privateKeyHex = await deriveECIESPrivateKeyFromWallet(recipientAddress);
        console.log('Derived ECIES private key from wallet signature');
        return privateKeyHex;
    } catch (error) {
        // Check if user has uploaded ECIES public key to blockchain
        let hasEciesPublicKey = false;
        try {
            const apiEndpoint = 'https://storage.datavault.space';
            const response = await fetch(
                `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${recipientAddress}/ecies-public-key`
            );
            hasEciesPublicKey = response.ok;
        } catch (fetchError) {
            // Ignore errors when checking
        }
        
        if (hasEciesPublicKey) {
            throw new Error(
                `Failed to derive ECIES private key for address ${recipientAddress}. ` +
                `You have uploaded your ECIES public key, but cannot derive the private key. ` +
                `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        } else {
            throw new Error(
                `ECIES public key not found for address ${recipientAddress}. ` +
                `Please upload your ECIES public key first using the "Upload ECIES Public Key" button.`
            );
        }
    }
}

/**
 * Decrypt a symmetric key (AES bundle) that was encrypted with ECIES
 * Derives the ECIES private key deterministically from wallet signature
 * 
 * @param encryptedFileKeyString - Encrypted AES bundle as pipe-delimited hex string: encryptedIV|encryptedKey
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @returns Decrypted AES bundle
 */
export async function decryptFileKeyWithECIES(
    encryptedFileKeyString: string,
    recipientAddress: string
): Promise<IAesBundle> {
    // Derive the ECIES private key deterministically from wallet signature
    const privateKeyHex = await getECIESPrivateKeyForAddress(recipientAddress);
    
    // Verify the private key corresponds to the public key on blockchain
    try {
        const privateKeyBytes = hexToUint8Array(privateKeyHex);
        // Use @noble/secp256k1 to derive public key from private key
        const { getPublicKey } = await import('@noble/secp256k1');
        const publicKeyFromPrivate = getPublicKey(privateKeyBytes, false); // false = uncompressed (65 bytes, starts with 04)
        const blockchainPublicKey = await getAccountPublicKey(recipientAddress);
        
        // Compare public keys (should match) - both should be uncompressed (65 bytes)
        if (publicKeyFromPrivate.length !== blockchainPublicKey.length) {
            const derivedPubKeyHex = uint8ArrayToHex(publicKeyFromPrivate);
            const blockchainPubKeyHex = uint8ArrayToHex(blockchainPublicKey);
            console.error('=== Public Key Mismatch ===');
            console.error('Derived public key (hex):', derivedPubKeyHex);
            console.error('Blockchain public key (hex):', blockchainPubKeyHex);
            throw new Error(`Public key length mismatch: derived=${publicKeyFromPrivate.length}, blockchain=${blockchainPublicKey.length}`);
        }
        
        let matches = true;
        let firstMismatchIndex = -1;
        for (let i = 0; i < publicKeyFromPrivate.length; i++) {
            if (publicKeyFromPrivate[i] !== blockchainPublicKey[i]) {
                matches = false;
                firstMismatchIndex = i;
                break;
            }
        }
        
        if (!matches) {
            const derivedPubKeyHex = uint8ArrayToHex(publicKeyFromPrivate);
            const blockchainPubKeyHex = uint8ArrayToHex(blockchainPublicKey);
            console.error('=== Public Key Mismatch ===');
            console.error('Derived public key (hex):', derivedPubKeyHex);
            console.error('Blockchain public key (hex):', blockchainPubKeyHex);
            console.error('First mismatch at byte index:', firstMismatchIndex);
            console.error('Derived byte:', publicKeyFromPrivate[firstMismatchIndex]?.toString(16));
            console.error('Blockchain byte:', blockchainPublicKey[firstMismatchIndex]?.toString(16));
            throw new Error(
                `ECIES private key does not correspond to blockchain public key. ` +
                `The public key on the blockchain was likely uploaded using a different signature message. ` +
                `Please delete and re-upload your ECIES public key.`
            );
        }
        
        console.log('✓ Verified: Derived private key matches blockchain public key');
    } catch (error) {
        console.error('Error verifying ECIES private key:', error);
        // Throw the error - don't proceed with decryption if keys don't match
        throw error;
    }
    
    // Decrypt AES bundle using ECIES with actual private key
    return await stringToAes(encryptedFileKeyString, privateKeyHex);
}

/**
 * Decrypt an account key (single 32-byte key) that was encrypted with ECIES
 * Derives the ECIES private key deterministically from wallet signature
 * 
 * @param encryptedAccountKeyHex - Encrypted account key as hex string (not pipe-delimited, just a single ECIES-encrypted value)
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @returns Decrypted account key (32 bytes as Uint8Array)
 */
export async function decryptAccountKeyWithECIES(
    encryptedAccountKeyHex: string,
    recipientAddress: string
): Promise<Uint8Array> {
    // Derive the ECIES private key deterministically from wallet signature
    const privateKeyHex = await getECIESPrivateKeyForAddress(recipientAddress);
    
    // Decrypt account key using ECIES (single hex string, not pipe-delimited)
    return await eciesDecryptWithPrivateKey(privateKeyHex, encryptedAccountKeyHex);
}

// ============================================================================
// Cryptographic Utilities
// ============================================================================

/**
 * Calculate Merkle root (SHA256 hash) of data
 */
export async function calculateMerkleRoot(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash filename (like OSD system protocol)
 * Combines filename with timestamp and hashes with SHA-256
 */
export async function hashFilename(filename: string): Promise<string> {
    const timestamp = Date.now().toString();
    const dataToHash = filename + timestamp;
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataToHash));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// AES Bundle Management (like Jackal)
// ============================================================================

/**
 * AES Bundle interface - contains IV and key for file encryption
 */
export interface IAesBundle {
    iv: Uint8Array;  // 16-byte initialization vector
    key: CryptoKey;  // AES-256 CryptoKey
}

/**
 * Generate a new AES key bundle for file encryption
 * Each file gets a unique AES key and IV
 * 
 * @returns AES bundle with random IV and generated key
 */
export async function genAesBundle(): Promise<IAesBundle> {
    // Generate random 16-byte IV (Jackal uses 16 bytes, we use 12 for GCM, but will use 16 for compatibility)
    const iv = crypto.getRandomValues(new Uint8Array(16));
    
    // Generate random 32-byte key and import as AES-256-GCM key
    // Set extractable: true so we can export it later for ECIES encryption
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 256 },
        true, // extractable: true - needed to export key bytes for ECIES encryption
        ['encrypt', 'decrypt']
    );
    
    return { iv, key };
}

/**
 * Export CryptoKey to Uint8Array (like Jackal's exportJackalKey)
 */
async function exportJackalKey(key: CryptoKey): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/**
 * Encrypts AES iv/CryptoKey set to string using receiver's ECIES public key (like Jackal)
 * 
 * @param recipientPublicKey - Recipient's public key (compressed secp256k1, 33 bytes as Uint8Array)
 * @param aesBundle - AES iv/CryptoKey set to encrypt
 * @returns Encrypted string with pipe "|" delimiter: encryptedIV|encryptedKey (both as hex)
 */
export async function aesToString(
    recipientPublicKey: Uint8Array,
    aesBundle: IAesBundle
): Promise<string> {
    // Convert public key to hex string
    const pubKeyHex = uint8ArrayToHex(recipientPublicKey);
    
    // Encrypt IV separately with ECIES
    const encryptedIV = await eciesEncryptWithPubKey(pubKeyHex, aesBundle.iv);
    
    // Export key bytes and encrypt separately with ECIES
    const keyBytes = await exportJackalKey(aesBundle.key);
    const encryptedKey = await eciesEncryptWithPubKey(pubKeyHex, keyBytes);
    
    // Return pipe-delimited hex strings: encryptedIV|encryptedKey
    return `${encryptedIV}|${encryptedKey}`;
}

/**
 * Decrypt an AES bundle from an encrypted string using ECIES (like Jackal)
 * 
 * @param encryptedBundleString - Encrypted AES bundle as pipe-delimited hex string: encryptedIV|encryptedKey
 * @param recipientPrivateKeyHex - Recipient's private key as hex string
 * @returns Decrypted AES bundle
 */
export async function stringToAes(
    encryptedBundleString: string,
    recipientPrivateKeyHex: string
): Promise<IAesBundle> {
    // Split by pipe delimiter
    const parts = encryptedBundleString.split('|');
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted bundle format: expected "encryptedIV|encryptedKey"');
    }
    
    const [encryptedIVHex, encryptedKeyHex] = parts;
    
    console.log('=== Decrypting AES Bundle Components ===');
    console.log('Encrypted IV hex length:', encryptedIVHex.length);
    console.log('Encrypted Key hex length:', encryptedKeyHex.length);
    console.log('Private key hex length:', recipientPrivateKeyHex.length);
    
    // Decrypt IV separately
    console.log('Decrypting IV...');
    let iv: Uint8Array;
    try {
        iv = await eciesDecryptWithPrivateKey(recipientPrivateKeyHex, encryptedIVHex);
        console.log('IV decrypted successfully, length:', iv.length);
    } catch (error) {
        console.error('Error decrypting IV:', error);
        throw new Error(`Failed to decrypt IV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Decrypt key separately
    console.log('Decrypting AES key...');
    let keyBytes: Uint8Array;
    try {
        keyBytes = await eciesDecryptWithPrivateKey(recipientPrivateKeyHex, encryptedKeyHex);
        console.log('AES key decrypted successfully, length:', keyBytes.length);
    } catch (error) {
        console.error('Error decrypting AES key:', error);
        throw new Error(`Failed to decrypt AES key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Ensure keyBytes is a proper ArrayBuffer for importKey
    const keyBuffer = keyBytes.buffer instanceof ArrayBuffer
        ? keyBytes.buffer
        : new Uint8Array(keyBytes).buffer;
    
    // Import key as AES-256-GCM CryptoKey
    // Set extractable: true so it can be exported later for sharing
    const key = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'AES-GCM', length: 256 },
        true, // extractable: true - needed to export key bytes for sharing
        ['encrypt', 'decrypt']
    );
    
    return { iv, key };
}

// ============================================================================
// File Encryption
// ============================================================================

/**
 * Encrypt file using chunked AES-256-GCM with an AES bundle
 * Each file gets its own unique AES key and IV
 * 
 * @param file - The file to encrypt
 * @param aesBundle - The AES bundle containing IV and key for encryption
 * @returns Array of encrypted chunks (each chunk is formatted with size header, IV, and encrypted data)
 * 
 * Format: [8-byte size header][12-byte IV][encrypted chunk + 16-byte tag]
 * Note: Uses 12-byte IVs for GCM (first 12 bytes of bundle IV for first chunk, random for others)
 */
export async function encryptFile(
    file: File | Blob,
    aesBundle: IAesBundle
): Promise<Blob[]> {
    const encryptedChunks: Blob[] = [];
    const fileSize = file.size;
    
    // Encrypt file in chunks
    for (let i = 0; i < fileSize; i += ENCRYPTION_CHUNK_SIZE) {
        const chunkBlob = file instanceof File ? file.slice(i, i + ENCRYPTION_CHUNK_SIZE) : 
                         new Blob([file]).slice(i, i + ENCRYPTION_CHUNK_SIZE);
        const chunkData = await chunkBlob.arrayBuffer();
        
        // Use bundle IV (first 12 bytes) for first chunk, random IVs for subsequent chunks
        // GCM requires 12-byte IVs
        const iv = i === 0 
            ? aesBundle.iv.slice(0, 12)  // Use first 12 bytes of bundle IV for first chunk
            : crypto.getRandomValues(new Uint8Array(12));  // Random IVs for other chunks
        
        // Encrypt chunk with AES-256-GCM (includes authentication tag)
        const encryptedChunkData = await crypto.subtle.encrypt(
            { 
                name: 'AES-GCM',
                iv: iv,
                tagLength: AES_TAG_LENGTH
            },
            aesBundle.key,
            chunkData
        );
        
        // Format: [8-byte size header][12-byte IV][encrypted chunk + 16-byte tag]
        // Size header includes: IV (12) + encrypted data + tag (16)
        const encryptedChunkArray = new Uint8Array(encryptedChunkData);
        const chunkSize = iv.length + encryptedChunkArray.length; // 12 + encrypted + 16
        
        // Create size header (8 bytes, padded with zeros)
        const sizeHeader = chunkSize.toString().padStart(8, '0');
        const sizeHeaderBytes = new TextEncoder().encode(sizeHeader);
        
        // Combine: size header + IV + encrypted chunk
        const combinedChunk = new Uint8Array(sizeHeaderBytes.length + chunkSize);
        combinedChunk.set(sizeHeaderBytes, 0);
        combinedChunk.set(iv, sizeHeaderBytes.length);
        combinedChunk.set(encryptedChunkArray, sizeHeaderBytes.length + iv.length);
        
        encryptedChunks.push(new Blob([combinedChunk]));
    }
    
    // Return array of encrypted chunks (each will be uploaded individually)
    return encryptedChunks;
}

// ============================================================================
// File Decryption
// ============================================================================

/**
 * Decrypt file using chunked AES-256-GCM with an AES bundle
 * 
 * @param encryptedBlob - The encrypted file blob (with size headers)
 * @param aesBundle - The AES bundle containing IV and key for decryption
 * @returns Decrypted file blob
 */
export async function decryptFile(
    encryptedBlob: Blob,
    aesBundle: IAesBundle
): Promise<Blob> {
    // Read encrypted data
    const encryptedData = await encryptedBlob.arrayBuffer();
    const encryptedArray = new Uint8Array(encryptedData);
    
    const decryptedChunks: Blob[] = [];
    let offset = 0;
    
    // Decrypt chunks
    while (offset < encryptedArray.length) {
        // Read 8-byte size header
        if (offset + 8 > encryptedArray.length) {
            throw new Error('Invalid encrypted file format: incomplete size header');
        }
        
        const sizeHeaderBytes = encryptedArray.slice(offset, offset + 8);
        const sizeHeader = new TextDecoder().decode(sizeHeaderBytes);
        const chunkSize = parseInt(sizeHeader, 10);
        
        if (isNaN(chunkSize) || chunkSize <= 0) {
            throw new Error(`Invalid chunk size header: ${sizeHeader}`);
        }
        
        offset += 8;
        
        // Validate we have enough data for this chunk
        if (offset + chunkSize > encryptedArray.length) {
            throw new Error(`Invalid encrypted file format: incomplete chunk (expected ${chunkSize} bytes)`);
        }
        
        // Extract IV (12 bytes) and encrypted chunk + tag
        const chunkData = encryptedArray.slice(offset, offset + chunkSize);
        const iv = chunkData.slice(0, 12);
        const ciphertextWithTag = chunkData.slice(12);
        
        // Validate ciphertext size (must have at least 16 bytes for authentication tag)
        if (ciphertextWithTag.length < 16) {
            throw new Error('Encrypted chunk is too small (missing authentication tag)');
        }
        
        // Decrypt chunk with AES-GCM (automatically verifies authentication tag)
        const decryptedChunkData = await crypto.subtle.decrypt(
            { 
                name: 'AES-GCM',
                iv: iv,
                tagLength: AES_TAG_LENGTH
            },
            aesBundle.key,
            ciphertextWithTag
        );
        
        decryptedChunks.push(new Blob([decryptedChunkData]));
        offset += chunkSize;
    }
    
    // Combine all decrypted chunks into single blob
    return new Blob(decryptedChunks);
}

// ============================================================================
// Blockchain Transactions
// ============================================================================

/**
 * Post file transaction to blockchain
 * 
 * @param merkleRoot - SHA256 hash of the encrypted file (combined from all chunks)
 * @param sizeBytes - Total size of encrypted file in bytes
 * @param expirationTime - Unix timestamp for file expiration
 * @param maxProofs - Maximum number of storage proofs required
 * @param metadata - File metadata (name, content_type, etc.)
 * @param rpcEndpoint - RPC endpoint URL (defaults to HTTPS through Caddy)
 * @param chainId - Chain ID (defaults to CHAIN_ID)
 * @returns Transaction result with hash and assigned storage providers
 * 
 * Note: Requires @cosmjs/stargate and @cosmjs/proto-signing
 * Note: Requires generated protobuf types (MsgPostFile, StorageProvider, etc.)
 */
export async function postFileToBlockchain(
    merkleRoot: string,
    sizeBytes: number,
    expirationTime: number,
    maxProofs: number,
    metadata: FileMetadata,
    encryptedFileKey: string,
    rpcEndpoint: string = 'https://storage.datavault.space/rpc',
    chainId: string = CHAIN_ID
): Promise<PostFileResult> {
    const keplr = getKeplr();
    if (!keplr) {
        throw new Error('Keplr not available');
    }

    // Ensure chain is enabled
    await keplr.enable(chainId);
    const offlineSigner = keplr.getOfflineSigner(chainId);
    const accounts = await offlineSigner.getAccounts();
    const userAddress = accounts[0].address;

    // Import required modules (dynamic import to avoid bundling issues)
    const { Registry } = await import('@cosmjs/proto-signing');
    const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
    
    // Note: These imports assume you have generated protobuf types
    // You'll need to adjust these imports based on your project structure
    // For now, we'll use a generic approach that can be customized
    let MsgPostFile: any;
    let StorageProvider: any;
    
    try {
        // Try to import generated types (adjust path as needed)
        const txModule = await import('./generated/osdblockchain/osdblockchain/v1/tx');
        const providerModule = await import('./generated/osdblockchain/osdblockchain/v1/storage_provider');
        MsgPostFile = txModule.MsgPostFile;
        StorageProvider = providerModule.StorageProvider;
    } catch (error) {
        // If generated types aren't available, provide instructions
        throw new Error(
            'Generated protobuf types not found. ' +
            'Please generate types from your .proto files using protoc or @cosmjs/proto-signing. ' +
            'Expected: ./generated/osdblockchain/osdblockchain/v1/tx and ./generated/osdblockchain/osdblockchain/v1/storage_provider'
        );
    }

    // Create a registry with your custom message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        ['/osdblockchain.osdblockchain.v1.MsgPostFile', MsgPostFile as any]
    ]);

    // Create signing client with the registry
    const signingClient = await SigningStargateClient.connectWithSigner(
        rpcEndpoint,
        offlineSigner,
        { registry }
    );

    // Query account to get current sequence number
    const account = await signingClient.getAccount(userAddress);
    if (!account) {
        throw new Error('Account not found');
    }

    // Create message using the generated type
    // Note: encryptedFileKey will be added to the generated types after protobuf update
    const msg = {
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgPostFile',
        value: MsgPostFile.fromPartial({
            owner: userAddress,
            merkleRoot: merkleRoot,
            sizeBytes: sizeBytes,
            expirationTime: expirationTime,
            maxProofs: maxProofs,
            metadata: JSON.stringify(metadata),
            encryptedFileKey: encryptedFileKey
        } as any) // Type assertion needed until generated types are updated
    };

    // Send transaction
    const fee = {
        amount: [{ denom: "stake", amount: "0" }],
        gas: '2000000'
    };

    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        fee,
        'Upload file to blockchain'
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    // Extract providers from transaction response
    let providers: StorageProvider[] = [];
    let primaryProviderIndex = -1;

    if (!result.transactionHash) {
        return {
            transactionHash: '',
            providers: providers,
            primaryProviderIndex: primaryProviderIndex
        };
    }

    try {
        // Wait for transaction to be included in a block
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Query the transaction to get the response
        const txQuery = await signingClient.getTx(result.transactionHash);
        
        if (txQuery && txQuery.events) {
            // Find the "post_file" event which contains provider information
            const postFileEvent = txQuery.events.find((event: any) => event.type === 'post_file');
            
            if (postFileEvent && postFileEvent.attributes) {
                // Parse attributes to extract provider information
                const providerMap = new Map<number, { id: string; address: string }>();
                
                for (const attr of postFileEvent.attributes) {
                    // Handle both string and Uint8Array key/value
                    const key = typeof attr.key === 'string' 
                        ? attr.key 
                        : (attr.key ? new TextDecoder().decode(attr.key) : '');
                    const value = typeof attr.value === 'string' 
                        ? attr.value 
                        : (attr.value ? new TextDecoder().decode(attr.value) : '');
                    
                    // Extract provider index and field from key (e.g., "provider_0_id" -> index: 0, field: "id")
                    const providerMatch = key.match(/^provider_(\d+)_(id|address)$/);
                    if (providerMatch) {
                        const index = parseInt(providerMatch[1], 10);
                        const field = providerMatch[2];
                        
                        if (!providerMap.has(index)) {
                            providerMap.set(index, { id: '', address: '' });
                        }
                        
                        const provider = providerMap.get(index)!;
                        if (field === 'id') {
                            provider.id = value;
                        } else if (field === 'address') {
                            provider.address = value;
                        }
                    }
                }
                
                // Convert map to array of StorageProvider objects
                if (providerMap.size > 0) {
                    const sortedIndices = Array.from(providerMap.keys()).sort((a, b) => a - b);
                    
                    for (const index of sortedIndices) {
                        const providerData = providerMap.get(index)!;
                        
                        if (providerData.id && providerData.address) {
                            const provider = StorageProvider.fromPartial({
                                providerId: providerData.id,
                                providerAddress: providerData.address,
                                registeredAt: 0,
                                lastUpdated: 0,
                                isActive: true,
                                totalCapacityBytes: 0,
                                usedCapacityBytes: 0
                            });
                            providers.push(provider);
                        }
                    }
                    
                    // Set primary provider index (usually 0)
                    primaryProviderIndex = 0;
                }
            }
        }
    } catch (error) {
        console.warn('Could not extract providers from transaction response:', error);
    }

    return {
        transactionHash: result.transactionHash || '',
        providers: providers,
        primaryProviderIndex: primaryProviderIndex
    };
}

// ============================================================================
// Export all
// ============================================================================

export default {
    // Encryption/Decryption
    encryptFile,
    decryptFile,
    encryptFileKeyWithECIES,
    decryptFileKeyWithECIES,
    calculateMerkleRoot,
    hashFilename,
    
    // AES Bundle Management
    genAesBundle,
    aesToString,
    stringToAes,
    
    // ECIES Functions
    eciesEncryptWithPubKey,
    eciesDecryptWithPrivateKey,
    
    // Key Management (Mnemonic-based, like Jackal)
    getPrivateKeyFromMnemonic,
    getPrivateKeyForAddress,
    setMnemonicForAddress,
    clearPrivateKeyCache,
    
    // ECIES Keypair Generation
    generateECIESKeypair,
    clearECIESPrivateKeyCache,
    
    // Blockchain
    postFileToBlockchain,
    
    // Utilities
    getKeplr,
    
    // Constants
    CHAIN_ID,
    ENCRYPTION_CHUNK_SIZE,
    PBKDF2_ITERATIONS,
    AES_TAG_LENGTH
};

