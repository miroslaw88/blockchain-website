// Fetch storage stats from blockchain

import { getStorageStatsTemplate } from './templates';

// Helper function to format file size
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Fetch and display storage statistics for a wallet address
 * @param walletAddress - The wallet address to query
 * @param onBuyStorageClick - Callback function to handle buy storage button click
 */
export async function fetchStorageStats(
    walletAddress: string,
    onBuyStorageClick: () => void
): Promise<void> {
    const $statsArea = $('#storageStatsArea');
    if ($statsArea.length === 0) return;

        try {
            // Query storage information from blockchain
            // REST API endpoint: GET /osd-blockchain/osdblockchain/v1/account/{address}/storage
            const apiEndpoint = 'https://storage.datavault.space';
            const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${walletAddress}/storage`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch storage stats: ${response.status}`);
        }

        const data = await response.json();
        
        // Parse response - handle both snake_case and camelCase
        const totalStorageBytes = parseInt(data.total_storage_bytes || data.totalStorageBytes || '0', 10);
        const activeStorageBytes = parseInt(data.active_storage_bytes || data.activeStorageBytes || '0', 10);
        const storageAmount = formatFileSize(activeStorageBytes);
        
        // Get expiration date from subscriptions
        // Based on shell script: subscriptions have end_time field
        let expirationDate = 'N/A';
        const subscriptions = data.subscriptions || [];
        if (subscriptions.length > 0) {
            // Find the latest expiration (end_time) from active subscriptions
            const activeSubscriptions = subscriptions.filter((sub: any) => 
                sub.is_active || sub.isActive === true
            );
            
            if (activeSubscriptions.length > 0) {
                // Get the latest end_time from active subscriptions
                const latestExpiration = activeSubscriptions
                    .map((sub: any) => {
                        // Handle both snake_case and camelCase, and both string and number formats
                        const endTime = sub.end_time || sub.endTime || '0';
                        return typeof endTime === 'string' ? parseInt(endTime, 10) : endTime;
                    })
                    .filter((exp: number) => exp > 0)
                    .sort((a: number, b: number) => b - a)[0];
                
                if (latestExpiration) {
                    // end_time is in seconds (Unix timestamp)
                    expirationDate = new Date(latestExpiration * 1000).toLocaleDateString();
                }
            } else {
                // No active subscriptions
                expirationDate = 'No active subscriptions';
            }
        }
        
        // Update stats area
        $statsArea.html(getStorageStatsTemplate(storageAmount, expirationDate));
        
        // Set up buy storage button click handler
        $('#buyStorageBtn').off('click').on('click', () => {
            onBuyStorageClick();
        });
    } catch (error) {
        console.error('Error fetching storage stats:', error);
        // Show default stats on error
        $statsArea.html(getStorageStatsTemplate('Unknown', 'N/A'));
        $('#buyStorageBtn').off('click').on('click', () => {
            onBuyStorageClick();
        });
    }
}

