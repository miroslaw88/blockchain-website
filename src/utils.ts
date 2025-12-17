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

// Format wallet address for display (first 5 + '...' + last 5)
export function formatWalletAddress(address: string): string {
    if (!address || address.length <= 10) {
        return address;
    }
    return `${address.substring(0, 5)}...${address.substring(address.length - 5)}`;
}

// Update wallet address display in header
export function updateWalletAddressDisplay(address: string | null): void {
    const $display = $('#walletAddressDisplay');
    if (address) {
        $display.text(formatWalletAddress(address));
    } else {
        $display.text('');
    }
}

// Format encryption key for display (show first 8 and last 8 bytes in hex)
export function formatEncryptionKey(keyBase64: string): string {
    try {
        // Decode base64 to get bytes
        const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        
        // Show first 8 bytes and last 8 bytes in hex
        const first8 = Array.from(keyBytes.slice(0, 8))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        const last8 = Array.from(keyBytes.slice(keyBytes.length - 8))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        return `${first8}...${last8}`;
    } catch (e) {
        // If decoding fails, just show truncated base64
        return keyBase64.length > 16 
            ? `${keyBase64.substring(0, 8)}...${keyBase64.substring(keyBase64.length - 8)}`
            : keyBase64;
    }
}

// Format date as YYYY-MM-DD with time (for file expiration, storage expiration, etc.)
export function formatDate(timestamp: number): string {
    if (!timestamp || timestamp === 0) {
        return 'N/A';
    }
    const date = new Date(timestamp * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString();
    return `${year}-${month}-${day} ${time}`;
}

