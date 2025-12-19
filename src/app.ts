// Main application entry point - single page app
import { Wallet } from './wallet';
import { Dashboard } from './dashboard';

// Show/hide views based on connection state
function showWalletConnectionView() {
    $('#walletConnectionView').css('display', 'flex');
    $('#dashboardView').removeClass('active').css('display', 'none');
}

function showDashboardView() {
    $('#walletConnectionView').css('display', 'none');
    $('#dashboardView').addClass('active').css('display', 'flex');
}

// Initialize app on page load
$(document).ready(async () => {
    // Check if wallet is already connected
    const walletConnected = sessionStorage.getItem('walletConnected');
    const walletAddress = sessionStorage.getItem('walletAddress');
    
    if (walletConnected === 'true' && walletAddress) {
        // Check if storage session signature exists in cache
        // After hard refresh, the in-memory cache is cleared, so we need to reconnect
        try {
            const { hasStorageSessionSignature } = await import('./osd-blockchain-sdk');
            const hasSignature = hasStorageSessionSignature(walletAddress);
            
            if (!hasSignature) {
                // No storage session signature cached (hard refresh cleared it)
                // Clear stale sessionStorage and show wallet connection screen
                console.log('No storage session signature found, showing wallet connection screen');
                sessionStorage.removeItem('walletConnected');
                sessionStorage.removeItem('walletAddress');
                sessionStorage.removeItem('walletName');
                sessionStorage.removeItem('chainId');
                showWalletConnectionView();
                Wallet.init();
                return;
            }
            
            // Storage session signature exists, show dashboard
            showDashboardView();
            Dashboard.init();
        } catch (error) {
            // If we can't check the storage session, treat as disconnected
            console.log('Error checking storage session, showing wallet connection screen:', error);
            // Clear stale sessionStorage
            sessionStorage.removeItem('walletConnected');
            sessionStorage.removeItem('walletAddress');
            sessionStorage.removeItem('walletName');
            sessionStorage.removeItem('chainId');
            showWalletConnectionView();
            Wallet.init();
        }
    } else {
        // Show wallet connection
        showWalletConnectionView();
        Wallet.init();
    }
});

// Export functions for wallet and dashboard to use
export function switchToDashboard() {
    showDashboardView();
    Dashboard.init();
}

export function switchToWalletConnection() {
    showWalletConnectionView();
    Wallet.init();
}

