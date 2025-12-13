// Fetch storage stats from blockchain

import { formatDate } from './utils';
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
 * @param onExtendStorageClick - Callback function to handle extend storage button click
 */
export async function fetchStorageStats(
    walletAddress: string,
    onBuyStorageClick: () => void,
    onExtendStorageClick: () => void
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
        const address = data.address || walletAddress;
        const totalStorageBytes = parseInt(data.total_storage_bytes || data.totalStorageBytes || '0', 10);
        const activeStorageBytes = parseInt(data.active_storage_bytes || data.activeStorageBytes || '0', 10);
        const totalStorageFormatted = formatFileSize(totalStorageBytes);
        const activeStorageFormatted = formatFileSize(activeStorageBytes);
        
        // Parse subscriptions array
        const subscriptions = (data.subscriptions || []).map((sub: any) => ({
            id: sub.id || '',
            storage_bytes: sub.storage_bytes || sub.storageBytes || '0',
            start_time: sub.start_time || sub.startTime || '0',
            end_time: sub.end_time || sub.endTime || '0',
            duration_seconds: sub.duration_seconds || sub.durationSeconds || '0',
            remaining_seconds: sub.remaining_seconds || sub.remainingSeconds || '0',
            is_active: sub.is_active !== undefined ? sub.is_active : (sub.isActive !== undefined ? sub.isActive : false)
        }));
        
        // Update stats area with all data
        $statsArea.html(getStorageStatsTemplate(
            address,
            totalStorageFormatted,
            activeStorageFormatted,
            subscriptions
        ));
        
        // Set up buy/extend storage button click handlers
        $('#buyStorageBtn').off('click').on('click', () => {
            onBuyStorageClick();
        });
        $('#extendStorageBtn').off('click').on('click', () => {
            onExtendStorageClick();
        });
        
        // Set up collapse toggle button text update
        $('#subscriptionDetails').on('show.bs.collapse', function () {
            $('#toggleSubscriptionBtn').html(`
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-1">
                    <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
                Hide Details
            `);
        });
        $('#subscriptionDetails').on('hide.bs.collapse', function () {
            $('#toggleSubscriptionBtn').html(`
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="me-1">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                Show Details
            `);
        });
    } catch (error) {
        console.error('Error fetching storage stats:', error);
        // Show default stats on error
        $statsArea.html(getStorageStatsTemplate(
            walletAddress,
            'Unknown',
            'Unknown',
            []
        ));
        $('#buyStorageBtn').off('click').on('click', () => {
            onBuyStorageClick();
        });
    }
}

