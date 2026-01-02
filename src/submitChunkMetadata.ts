// Submit chunk metadata to indexers

export interface ChunkInfo {
    index: number;
    hash: string;
    size: number;
}

export interface IndexerInfo {
    indexer_id: string;
    indexer_address: string;
    hash_prefix_start?: string;
    hash_prefix_end?: string;
    prefix_depth?: number;
    is_exact_prefix?: boolean;
    group_id?: number;
    file_count?: number;
    query_count?: number;
    registered_at?: number;
    last_updated?: number;
    is_active?: boolean;
}

export interface QueryIndexersForFileResponse {
    indexers: IndexerInfo[];
}

export interface SubmitChunkMetadataResult {
    successCount: number;
    failureCount: number;
    indexers: IndexerInfo[];
}

// Query which indexers handle a specific merkle root
export async function queryIndexersForFile(merkleRoot: string): Promise<QueryIndexersForFileResponse> {
    try {
        const apiEndpoint = 'https://storage.datavault.space';
        const response = await fetch(`${apiEndpoint}/osd-blockchain/osdblockchain/v1/indexers/file/${merkleRoot}`);
        
        if (!response.ok) {
            throw new Error(`Failed to query indexers for file: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return {
            indexers: data.indexers || []
        };
    } catch (error) {
        console.error('Error querying indexers for file:', error);
        throw error;
    }
}

// Submit chunk metadata to indexers via HTTP
// Note: Chunks array is no longer sent here - indexers should read it from the blockchain event
export async function submitChunkMetadata(
    owner: string,
    merkleRoot: string,
    encryptedFileKey: string
): Promise<SubmitChunkMetadataResult> {
    // Step 1: Query which indexers handle this merkle root
    console.log('Querying indexers for merkle root:', merkleRoot);
    const indexersResponse = await queryIndexersForFile(merkleRoot);
    console.log('Indexers response:', indexersResponse);
    const indexers = indexersResponse.indexers.filter(indexer => indexer.is_active === true);
    
    if (indexers.length === 0) {
        throw new Error('No active indexers found for this merkle root');
    }
    
    console.log(`Found ${indexers.length} active indexer(s) for merkle root:`, indexers);
    
    // Step 2: Submit chunk metadata to each indexer
    const results = await Promise.allSettled(
        indexers.map(async (indexer) => {
            const protocol = indexer.indexer_address.includes('localhost') || indexer.indexer_address.match(/^\d+\.\d+\.\d+\.\d+/) ? 'http' : 'https';
            const indexerUrl = `${protocol}://${indexer.indexer_address}/api/indexer/v1/chunks`;
            
            console.log(`Submitting chunk metadata to indexer ${indexer.indexer_id} at ${indexerUrl}`);
            
            const payload = {
                owner: owner,
                merkleRoot: merkleRoot,
                encryptedFileKey: encryptedFileKey
            };
            
             const response = await fetch(indexerUrl, {
                 method: 'POST',
                 headers: {
                     'Content-Type': 'application/json'
                 },
                 body: JSON.stringify(payload)
             });
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Indexer ${indexer.indexer_id} returned ${response.status}: ${errorText}`);
            }
            
            console.log(`Successfully submitted chunk metadata to indexer ${indexer.indexer_id}`);
            return indexer;
        })
    );
    
    // Count successes and failures
    let successCount = 0;
    let failureCount = 0;
    const successfulIndexers: IndexerInfo[] = [];
    
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            successCount++;
            successfulIndexers.push(result.value);
        } else {
            failureCount++;
            console.error(`Failed to submit to indexer ${indexers[index].indexer_id}:`, result.reason);
        }
    });
    
    if (successCount === 0) {
        throw new Error(`Failed to submit chunk metadata to any indexer. ${failureCount} failure(s).`);
    }
    
    console.log(`Chunk metadata submitted: ${successCount} success(es), ${failureCount} failure(s)`);
    
    return {
        successCount,
        failureCount,
        indexers: successfulIndexers
    };
}

