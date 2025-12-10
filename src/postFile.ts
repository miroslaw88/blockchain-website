// Post file transaction to blockchain

import { getKeplr, CHAIN_ID } from './utils';
import type { StorageProvider } from './generated/osdblockchain/osdblockchain/v1/storage_provider';

export interface PostFileResult {
    transactionHash: string;
    providers: StorageProvider[];
    primaryProviderIndex: number;
}

export async function postFile(
    merkleRoot: string,
    sizeBytes: number,
    expirationTime: number,
    maxProofs: number,
    metadata: { name: string; content_type: string }
): Promise<PostFileResult> {
    const keplr = getKeplr();
    if (!keplr) {
        throw new Error('Keplr not available');
    }

    // Ensure chain is enabled
    await keplr.enable(CHAIN_ID);
    const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    const userAddress = accounts[0].address;

    // Import required modules
    const { Registry } = await import('@cosmjs/proto-signing');
    const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
    const { MsgPostFile, MsgPostFileResponse } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

    // Create a registry with your custom message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        // Register your custom message type
        // Type assertion needed because generated types use MessageFns instead of GeneratedType
        ['/osdblockchain.osdblockchain.v1.MsgPostFile', MsgPostFile as any]
    ]);

    // Connect to RPC
    // Try HTTPS through Caddy first, fallback to localhost if CORS issues
    let rpcEndpoint = 'https://storage.datavault.space/rpc';
    
    // If accessing from same machine, localhost avoids CORS
    // Uncomment the line below if you're running locally:
    // rpcEndpoint = 'http://localhost:26667';
    
    // Create signing client with the registry
    const signingClient = await SigningStargateClient.connectWithSigner(
        rpcEndpoint,
        offlineSigner,
        { registry }
    );

    // Query account to get current sequence number
    // This ensures we use the correct sequence and avoid sequence mismatches
    const account = await signingClient.getAccount(userAddress);
    if (!account) {
        throw new Error('Account not found');
    }
    
    console.log('Current account sequence:', account.sequence);

    // Create message using the generated type
    const msg = {
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgPostFile',
        value: MsgPostFile.fromPartial({
            owner: userAddress,
            merkleRoot: merkleRoot,  // Note: camelCase (not snake_case)
            sizeBytes: sizeBytes,  // number, not string
            expirationTime: expirationTime,  // number
            maxProofs: maxProofs,  // number
            metadata: JSON.stringify(metadata)
        })
    };

    // Send transaction
    const fee = {
        amount: [{ denom: "stake", amount: "0" }],  // Fees = 0
        gas: '2000000'
    };

    console.log('Broadcasting transaction with sequence:', account.sequence);
    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        fee,
        'Upload file to blockchain'
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    // Extract providers from transaction response
    // Query the transaction to get the MsgPostFileResponse with providers
    let providers: StorageProvider[] = [];
    let primaryProviderIndex = -1;

    // Check if transaction hash exists
    if (!result.transactionHash) {
        console.warn('Transaction hash not available in result');
        return {
            transactionHash: '',
            providers: providers,
            primaryProviderIndex: primaryProviderIndex
        };
    }

    try {
        // Wait for transaction to be included in a block, then query it
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Query the transaction to get the response
        const txQuery = await signingClient.getTx(result.transactionHash);
        
        if (txQuery && txQuery.events) {
            // Find the "post_file" event which contains provider information
            const postFileEvent = txQuery.events.find((event: any) => event.type === 'post_file');
            
            if (postFileEvent && postFileEvent.attributes) {
                // Parse attributes to extract provider information
                // Providers are stored as: provider_0_id, provider_0_address, provider_1_id, etc.
                const providerMap = new Map<number, { id: string; address: string }>();
                
                for (const attr of postFileEvent.attributes) {
                    const key = typeof attr.key === 'string' ? attr.key : (attr.key ? Buffer.from(attr.key).toString() : '');
                    const value = typeof attr.value === 'string' ? attr.value : (attr.value ? Buffer.from(attr.value).toString() : '');
                    
                    // Extract provider index and field from key (e.g., "provider_0_id" -> index: 0, field: "id")
                    const providerMatch = key.match(/^provider_(\d+)_(id|address)$/);
                    if (providerMatch) {
                        const index = parseInt(providerMatch[1], 10);
                        const field = providerMatch[2];
                        
                        if (!providerMap.has(index)) {
                            providerMap.set(index, { id: '', address: '' });
                        }
                        
                        const provider = providerMap.get(index)!;
                        if (field === 'id') {
                            provider.id = value;
                        } else if (field === 'address') {
                            provider.address = value;
                        }
                    }
                }
                
                // Convert map to array of StorageProvider objects
                if (providerMap.size > 0) {
                    console.log('=== Extracting providers from event ===');
                    console.log('Provider map:', Array.from(providerMap.entries()));
                    
                    const { StorageProvider } = await import('./generated/osdblockchain/osdblockchain/v1/storage_provider');
                    
                    // Sort by index to maintain order
                    const sortedIndices = Array.from(providerMap.keys()).sort((a, b) => a - b);
                    console.log('Sorted provider indices:', sortedIndices);
                    
                    for (const index of sortedIndices) {
                        const providerData = providerMap.get(index)!;
                        console.log(`Processing provider ${index}:`, providerData);
                        
                        if (providerData.id && providerData.address) {
                            // Create StorageProvider from the data we have
                            // Note: Some fields may not be available in events, so we use defaults
                            const provider = StorageProvider.fromPartial({
                                providerId: providerData.id,
                                providerAddress: providerData.address,
                                registeredAt: 0, // Not available in events
                                lastUpdated: 0,  // Not available in events
                                isActive: true,   // Assume active if assigned
                                totalCapacityBytes: 0, // Not available in events
                                usedCapacityBytes: 0   // Not available in events
                            });
                            providers.push(provider);
                            console.log(`Added provider ${index}:`, provider);
                        } else {
                            console.warn(`Provider ${index} missing id or address:`, providerData);
                        }
                    }
                    
                    // Set primary provider index (usually 0, or check if there's a specific attribute)
                    // For now, use 0 as the primary provider
                    primaryProviderIndex = 0;
                    console.log('Final providers array:', providers);
                    console.log('Primary provider index:', primaryProviderIndex);
                } else {
                    console.warn('No providers found in providerMap');
                }
            }
        }
    } catch (error) {
        console.warn('Could not extract providers from transaction response:', error);
        // Continue without providers - they may be empty if none are available
        // The file upload will still succeed, but won't upload to a storage provider immediately
    }

    return {
        transactionHash: result.transactionHash || '',
        providers: providers,
        primaryProviderIndex: primaryProviderIndex
    };
}

