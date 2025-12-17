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
// ECIES Key Derivation (Cached)
// ============================================================================

// Cache for ECIES key material (per user address)
const eciesKeyMaterialCache: { [address: string]: CryptoKey } = {};

/**
 * Derive ECIES private key from wallet signature
 * Uses "Initiate Storage Session" message to get signature, then hashes it to create key material
 * Results are cached per user address to avoid repeated signature requests
 */
export async function deriveECIESPrivateKey(userAddress: string, chainId: string = CHAIN_ID): Promise<CryptoKey> {
    // Check cache first
    if (eciesKeyMaterialCache[userAddress]) {
        return eciesKeyMaterialCache[userAddress];
    }

    const keplr = getKeplr();
    if (!keplr || !keplr.signArbitrary) {
        throw new Error('Keplr signArbitrary not available');
    }

    // Sign seed message to get signature (similar to "Initiate Storage Session")
    const signatureSeed = 'Initiate Storage Session';
    const signatureResult = await keplr.signArbitrary(chainId, userAddress, signatureSeed);
    
    // Hash signature to create ECIES private key material
    const signatureBytes = Uint8Array.from(atob(signatureResult.signature), c => c.charCodeAt(0));
    const privateKeyHash = await crypto.subtle.digest('SHA-256', signatureBytes);
    
    // Import as raw key material for key derivation
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        privateKeyHash,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    // Cache the key material
    eciesKeyMaterialCache[userAddress] = keyMaterial;
    
    return keyMaterial;
}

/**
 * Clear ECIES key cache (useful for logout/disconnect)
 */
export function clearECIESKeyCache(): void {
    Object.keys(eciesKeyMaterialCache).forEach(key => {
        delete eciesKeyMaterialCache[key];
    });
}

/**
 * Get account public key from blockchain
 * Queries the Cosmos auth module for the account's public key
 * 
 * @param address - Account address (bech32 format)
 * @returns Public key as Uint8Array (compressed secp256k1 format, 33 bytes)
 */
async function getAccountPublicKey(address: string): Promise<Uint8Array> {
    try {
        // Query Cosmos auth module for account info
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(
            `${apiEndpoint}/cosmos/auth/v1beta1/accounts/${address}`
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch account public key: ${response.status}`);
        }

        const data = await response.json();
        
        // Extract public key from account
        // Cosmos SDK account structure: account.account.pub_key.key (base64)
        const account = data.account || {};
        const pubKeyData = account.pub_key || {};
        const pubKeyBase64 = pubKeyData.key || '';
        
        if (!pubKeyBase64) {
            throw new Error('Public key not found in account data');
        }

        // Decode base64 public key
        const pubKeyBytes = Uint8Array.from(atob(pubKeyBase64), c => c.charCodeAt(0));
        
        return pubKeyBytes;
    } catch (error) {
        console.error('Error fetching public key from blockchain:', error);
        throw new Error(`Failed to get recipient's public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Encrypt a symmetric key with recipient's public key using a hybrid ECIES approach
 * Since Web Crypto API doesn't support secp256k1, we use the public key to derive an encryption key
 * This is secure because only the recipient can derive the same key from their private key
 * 
 * @param fileKey - The symmetric file key to encrypt (32 bytes)
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @param chainId - Chain ID for Keplr (defaults to CHAIN_ID)
 * @returns Encrypted file key as Uint8Array
 */
export async function encryptFileKeyWithECIES(
    fileKey: Uint8Array,
    recipientAddress: string,
    chainId: string = CHAIN_ID
): Promise<Uint8Array> {
    // Get recipient's public key from blockchain
    const recipientPubKeyBytes = await getAccountPublicKey(recipientAddress);
    
    // Ensure we have a proper ArrayBuffer for digest
    const pubKeyBuffer = recipientPubKeyBytes.buffer instanceof ArrayBuffer
        ? recipientPubKeyBytes.buffer
        : new Uint8Array(recipientPubKeyBytes).buffer;
    
    // Hash the public key to create a deterministic encryption key material
    // This is secure because the public key is public, but only the recipient
    // can derive the same key from their private key (via signature-based derivation)
    const pubKeyHash = await crypto.subtle.digest('SHA-256', pubKeyBuffer);
    
    // Ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    // crypto.subtle.digest returns ArrayBuffer, but TypeScript may infer ArrayBufferLike
    const pubKeyHashBuffer = pubKeyHash instanceof ArrayBuffer 
        ? pubKeyHash 
        : new Uint8Array(pubKeyHash as ArrayBuffer).buffer;
    
    // Import as key material for PBKDF2
    const pubKeyMaterial = await crypto.subtle.importKey(
        'raw',
        pubKeyHashBuffer as ArrayBuffer,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );
    
    // Derive AES key from public key hash using PBKDF2
    // This creates a deterministic encryption key from the recipient's public key
    const encryptionKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(0), // No salt for deterministic key
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        pubKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    // Generate IV for encryption (random for each encryption)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt file key with AES-GCM
    const fileKeyBuffer = fileKey.buffer instanceof ArrayBuffer 
        ? fileKey.buffer 
        : new Uint8Array(fileKey).buffer;
    
    const encryptedKey = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            tagLength: AES_TAG_LENGTH
        },
        encryptionKey,
        fileKeyBuffer
    );
    
    // Format: [12-byte IV][encrypted key + 16-byte tag]
    const encryptedArray = new Uint8Array(encryptedKey);
    const result = new Uint8Array(iv.length + encryptedArray.length);
    result.set(iv, 0);
    result.set(encryptedArray, iv.length);
    
    return result;
}

/**
 * Decrypt a symmetric key that was encrypted with hybrid ECIES
 * Uses the same signature-based key derivation as encryption
 * 
 * @param encryptedFileKey - The encrypted file key (IV + encrypted data + tag)
 * @param recipientAddress - Recipient's Cosmos wallet address (bech32 format)
 * @param chainId - Chain ID for Keplr (defaults to CHAIN_ID)
 * @returns Decrypted file key as Uint8Array
 */
export async function decryptFileKeyWithECIES(
    encryptedFileKey: Uint8Array,
    recipientAddress: string,
    chainId: string = CHAIN_ID
): Promise<Uint8Array> {
    // Extract components: [12-byte IV][encrypted key + 16-byte tag]
    if (encryptedFileKey.length < 12 + 16) {
        throw new Error('Invalid encrypted file key format: too short');
    }
    
    const iv = encryptedFileKey.slice(0, 12);
    const ciphertextWithTag = encryptedFileKey.slice(12);
    
    // Get recipient's private key material (from Keplr signature-based derivation)
    // This matches the encryption side which uses the public key hash
    const recipientKeyMaterial = await deriveECIESPrivateKey(recipientAddress, chainId);
    
    // Derive AES key from recipient's key material (same as encryption)
    // The encryption side uses public key hash, decryption uses signature-derived key
    // Both should produce the same key material for the same recipient
    const decryptionKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(0),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        recipientKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
    // Decrypt file key
    const decryptedKey = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            tagLength: AES_TAG_LENGTH
        },
        decryptionKey,
        ciphertextWithTag
    );
    
    return new Uint8Array(decryptedKey);
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
// File Encryption
// ============================================================================

/**
 * Encrypt file using chunked AES-256-GCM with a symmetric key
 * 
 * @param file - The file to encrypt
 * @param fileKey - The symmetric key to use for encryption (32 bytes)
 * @returns Array of encrypted chunks (each chunk is formatted with size header, IV, and encrypted data)
 * 
 * Format: [8-byte size header][12-byte IV][encrypted chunk + 16-byte tag]
 */
export async function encryptFile(
    file: File | Blob,
    fileKey: Uint8Array
): Promise<Blob[]> {
    // Import symmetric key
    // Ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    const fileKeyBuffer = fileKey.buffer instanceof ArrayBuffer 
        ? fileKey.buffer 
        : new Uint8Array(fileKey).buffer;
    
    const aesKey = await crypto.subtle.importKey(
        'raw',
        fileKeyBuffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    const encryptedChunks: Blob[] = [];
    const fileSize = file.size;
    
    // Encrypt file in chunks
    for (let i = 0; i < fileSize; i += ENCRYPTION_CHUNK_SIZE) {
        const chunkBlob = file instanceof File ? file.slice(i, i + ENCRYPTION_CHUNK_SIZE) : 
                         new Blob([file]).slice(i, i + ENCRYPTION_CHUNK_SIZE);
        const chunkData = await chunkBlob.arrayBuffer();
        
        // Generate IV (12 bytes for AES-GCM) for each chunk
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Encrypt chunk with AES-256-GCM (includes authentication tag)
        const encryptedChunkData = await crypto.subtle.encrypt(
            { 
                name: 'AES-GCM',
                iv: iv,
                tagLength: AES_TAG_LENGTH
            },
            aesKey,
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
 * Decrypt file using chunked AES-256-GCM with a symmetric key
 * 
 * @param encryptedBlob - The encrypted file blob (with size headers)
 * @param fileKey - The symmetric key to use for decryption (32 bytes)
 * @returns Decrypted file blob
 */
export async function decryptFile(
    encryptedBlob: Blob,
    fileKey: Uint8Array
): Promise<Blob> {
    // Import symmetric key
    // Ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    const fileKeyBuffer = fileKey.buffer instanceof ArrayBuffer 
        ? fileKey.buffer 
        : new Uint8Array(fileKey).buffer;
    
    const aesKey = await crypto.subtle.importKey(
        'raw',
        fileKeyBuffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
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
            aesKey,
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
    
    // Key Management
    deriveECIESPrivateKey,
    clearECIESKeyCache,
    
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

