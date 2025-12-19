// Indexer management functionality

// Store active indexers
let activeIndexers: Array<{
    indexer_id: string;
    indexer_address: string;
    hash_prefix_start?: string;
    prefix_depth?: string;
    hash_prefix_end?: string;
    is_exact_prefix?: boolean;
    group_id?: string;
    file_count?: string;
    query_count?: string;
    registered_at?: string;
    last_updated?: string;
    is_active?: boolean;
}> = [];

// Get a random active indexer
export function getRandomIndexer(): { indexer_address: string } | null {
    if (activeIndexers.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * activeIndexers.length);
    return {
        indexer_address: activeIndexers[randomIndex].indexer_address
    };
}

// Get all active indexers
export function getAllActiveIndexers(): Array<{ indexer_address: string }> {
    return activeIndexers.map(indexer => ({
        indexer_address: indexer.indexer_address
    }));
}

// Wait for an indexer to become available (polling every 500ms, max 60 seconds)
export async function waitForIndexer(maxWaitTime: number = 60000): Promise<{ indexer_address: string }> {
    const startTime = Date.now();
    const checkInterval = 500; // Check every 500ms
    
    return new Promise((resolve, reject) => {
        const checkIndexer = () => {
            const indexer = getRandomIndexer();
            if (indexer) {
                resolve(indexer);
                return;
            }
            
            // Check if we've exceeded max wait time
            if (Date.now() - startTime >= maxWaitTime) {
                reject(new Error('No active indexers available. Please wait and try again.'));
                return;
            }
            
            // Check again after interval
            setTimeout(checkIndexer, checkInterval);
        };
        
        // Start checking
        checkIndexer();
    });
}

// Query active indexers from blockchain
export async function queryActiveIndexers(): Promise<void> {
    try {
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/indexers/active`);
        
        if (!response.ok) {
            console.error('Failed to fetch active indexers:', response.status);
            return;
        }
        
        const data = await response.json();
        
        // Store active indexers
        if (data.indexers && Array.isArray(data.indexers)) {
            activeIndexers = data.indexers.filter((indexer: any) => indexer.is_active === true);
        }
    } catch (error) {
        console.error('Error querying active indexers:', error);
    }
}

// Start polling active indexers every 5 seconds
export function startIndexerPolling(): void {
    // Query immediately on start
    queryActiveIndexers();
    
    // Then query every 5 seconds
    setInterval(() => {
        queryActiveIndexers();
    }, 5000);
}

