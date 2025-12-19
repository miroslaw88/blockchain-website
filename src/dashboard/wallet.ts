// Wallet disconnect functionality

import { getKeplr, CHAIN_ID, eciesKeyMaterialCache, updateWalletAddressDisplay } from '../utils';
import { clearECIESPrivateKeyCache } from '../osd-blockchain-sdk';

// Disconnect wallet function
export async function disconnectWallet(): Promise<void> {
    try {
        const keplr = getKeplr();
        if (keplr && keplr.disable) {
            await keplr.disable(CHAIN_ID);
        }
    } catch (error) {
        console.error('Error disconnecting wallet:', error);
    } finally {
        // Clear ECIES key cache
        Object.keys(eciesKeyMaterialCache).forEach(key => {
            delete eciesKeyMaterialCache[key];
        });
        
        // Clear ECIES private key cache from osd-blockchain-sdk
        clearECIESPrivateKeyCache();
        
        // Clear all wallet session data
        sessionStorage.removeItem('walletConnected');
        sessionStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletName');
        sessionStorage.removeItem('chainId');
        
        // Clear wallet address display
        updateWalletAddressDisplay(null);
        
        // Switch back to wallet connection view (no redirect)
        import('../app').then(({ switchToWalletConnection }) => {
            switchToWalletConnection();
        });
    }
}

