// Shared utilities for blockchain operations

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

// OSD Blockchain chain configuration
export const CHAIN_ID = 'osdblockchain';

// Get Keplr instance
export function getKeplr(): KeplrWindow['keplr'] {
    const window = globalThis as unknown as KeplrWindow;
    return window.keplr;
}

// Cache for ECIES key material (per user address) - shared across modules
export const eciesKeyMaterialCache: { [address: string]: CryptoKey } = {};

// Derive ECIES private key from wallet signature (hash signature to get private key)
// This is shared between dashboard.ts and fetchFiles.ts
export async function deriveECIESPrivateKey(userAddress: string): Promise<CryptoKey> {
    // Check cache first
    if (eciesKeyMaterialCache[userAddress]) {
        console.log('✓ Using cached ECIES key material for', userAddress);
        return eciesKeyMaterialCache[userAddress];
    }

    console.log('⚠ ECIES key not in cache, requesting signature for', userAddress);
    console.log('Cache keys:', Object.keys(eciesKeyMaterialCache));
    const keplr = getKeplr();
    if (!keplr || !keplr.signArbitrary) {
        throw new Error('Keplr signArbitrary not available');
    }

    // Sign seed message to get signature (similar to "Initiate Storage Session")
    const signatureSeed = 'Initiate Storage Session';
    console.log('Requesting signature for message:', signatureSeed);
    const signatureResult = await keplr.signArbitrary(CHAIN_ID, userAddress, signatureSeed);
    console.log('Signature received, deriving key material...');
    
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
    console.log('✓ ECIES key material cached for', userAddress);
    console.log('Cache now contains:', Object.keys(eciesKeyMaterialCache));
    
    return keyMaterial;
}

