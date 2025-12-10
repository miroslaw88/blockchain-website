// Shared utilities for blockchain operations

export interface KeplrWindow extends Window {
    keplr?: {
        enable: (chainId: string) => Promise<void>;
        disable: (chainId: string) => Promise<void>;
        getOfflineSigner: (chainId: string) => any;
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

