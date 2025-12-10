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
$(document).ready(() => {
    // Check if wallet is already connected
    const walletConnected = sessionStorage.getItem('walletConnected');
    
    if (walletConnected === 'true') {
        // Show dashboard
        showDashboardView();
        Dashboard.init();
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

