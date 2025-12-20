// Main dashboard module - orchestrates all dashboard functionality

import { getKeplr, CHAIN_ID, deriveECIESPrivateKey, updateWalletAddressDisplay } from '../utils';
import { fetchFiles } from '../fetchFiles';
import { fetchStorageStats } from '../fetchStorageStats';
import { disconnectWallet } from './wallet';
import { initDragAndDrop } from './dragAndDrop';
import { handleFiles } from './fileUpload';
import { startIndexerPolling, getRandomIndexer as _getRandomIndexer, getAllActiveIndexers as _getAllActiveIndexers, waitForIndexer as _waitForIndexer } from './indexers';
import { showBuyStorageModal, showExtendStorageModal } from './storageModals';
import { checkAndUpdateAccountKeyStatus, checkECIESKeyAndShowModal, handleDeleteAccountKey, handleGenerateAccountKey } from './eciesKeyManagement';
import { requestTokensFromFaucet } from '../faucet';
import { showToast } from '../fetchFiles/utils';

export namespace Dashboard {
    // Export indexer functions
    export const getRandomIndexer = _getRandomIndexer;
    export const getAllActiveIndexers = _getAllActiveIndexers;
    export const waitForIndexer = _waitForIndexer;
    
    // Initialize dashboard
    export function init() {
        // Disconnect button
        $('#disconnectBtn').on('click', disconnectWallet);
        
        // Get Tokens button
        $('#getTokensBtn').on('click', handleGetTokens);

        // Generate account key button (delegated event handler for dynamically added button)
        // Remove any existing handlers first to prevent duplicates
        $(document).off('click', '#generateKeyBtn', handleGenerateAccountKey);
        $(document).on('click', '#generateKeyBtn', handleGenerateAccountKey);
        
        // Delete account key button (delegated event handler for dynamically added button)
        $(document).off('click', '#deleteKeyBtn', handleDeleteAccountKey);
        $(document).on('click', '#deleteKeyBtn', handleDeleteAccountKey);

        // Initialize drag and drop
        initDragAndDrop(handleFiles);

        // Start polling active indexers
        startIndexerPolling();

        // Initialize ECIES key cache if wallet is connected
        // This ensures the cache is ready before any file operations
        // Do this synchronously before setting up event listeners
        const initializeECIESKey = async () => {
            try {
                const walletAddress = sessionStorage.getItem('walletAddress');
                if (walletAddress) {
                    const keplr = getKeplr();
                    if (keplr) {
                        await keplr.enable(CHAIN_ID);
                        // Pre-initialize ECIES key material (will use cache if already exists)
                        await deriveECIESPrivateKey(walletAddress);
                        console.log('ECIES key material initialized on dashboard load');
                    }
                }
            } catch (error) {
                console.warn('Failed to initialize ECIES key on dashboard load:', error);
                // Don't throw - this is optional, will be initialized on first use
            }
        };
        
        // Start initialization immediately (don't await, but it will cache before first use)
        initializeECIESKey();

        // Check if user has wallet info in sessionStorage
        const walletInfo = sessionStorage.getItem('walletConnected');
        if (!walletInfo) {
            // If no wallet info, switch to wallet connection view
            import('../app').then(({ switchToWalletConnection }) => {
                switchToWalletConnection();
            });
            return;
        }
        
        // Update wallet address display
        const walletAddress = sessionStorage.getItem('walletAddress');
        if (walletAddress) {
            updateWalletAddressDisplay(walletAddress);
            
            // Check if ECIES key exists, show setup modal if not
            checkECIESKeyAndShowModal(walletAddress);
            
            // Check account key status and update header
            checkAndUpdateAccountKeyStatus(walletAddress);
            
            // Fetch and display storage stats
            fetchStorageStats(walletAddress, () => showBuyStorageModal(async () => showExtendStorageModal(() => showBuyStorageModal(async () => {}))), async () => showExtendStorageModal(() => showBuyStorageModal(async () => {})));
            
            // Fetch files automatically
            fetchFiles(walletAddress);
        }
    }
}

// Handle Get Tokens button click
async function handleGetTokens(): Promise<void> {
    const $button = $('#getTokensBtn');
    const originalText = $button.html();
    
    // Disable button and show loading state
    $button.prop('disabled', true);
    $button.html(`
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Requesting...
    `);
    
    try {
        const walletAddress = sessionStorage.getItem('walletAddress');
        if (!walletAddress) {
            showToast('Wallet address not found. Please connect your wallet.', 'error');
            return;
        }
        
        // Request tokens from faucet
        const result = await requestTokensFromFaucet(walletAddress, '1000000');
        
        if (result.success) {
            const message = result.tx_hash 
                ? `Tokens requested successfully! Transaction: ${result.tx_hash.substring(0, 16)}...`
                : result.message || 'Tokens requested successfully!';
            showToast(message, 'success');
        } else {
            showToast(result.error || 'Failed to request tokens from faucet', 'error');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens';
        console.error('Get tokens error:', error);
        showToast(errorMessage, 'error');
    } finally {
        // Restore button state
        $button.prop('disabled', false);
        $button.html(originalText);
    }
}

