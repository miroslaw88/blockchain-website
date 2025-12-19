// Create directory transaction to blockchain

import { getKeplr, CHAIN_ID } from './utils';

export interface CreateDirectoryResult {
    transactionHash: string;
    createdAt: number;
}

/**
 * Normalize directory path to ensure consistent format
 * - Ensures path starts with /
 * - Ensures directory paths end with / (except root)
 * - Cleans the path
 */
function normalizeDirectoryPath(path: string): string {
    if (path === '') {
        return '';
    }

    // Clean the path
    path = path.trim().replace(/\\/g, '/'); // Normalize backslashes to forward slashes
    
    // Remove duplicate slashes
    path = path.replace(/\/+/g, '/');
    
    // Ensure it starts with /
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    
    // For root directory, return "/"
    if (path === '/') {
        return '/';
    }
    
    // Ensure directory paths end with / for consistent matching
    if (!path.endsWith('/')) {
        path = path + '/';
    }
    
    return path;
}

export async function createDirectory(path: string): Promise<CreateDirectoryResult> {
    const keplr = getKeplr();
    if (!keplr) {
        throw new Error('Keplr not available');
    }

    // Ensure chain is enabled
    await keplr.enable(CHAIN_ID);
    const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
    const accounts = await offlineSigner.getAccounts();
    const userAddress = accounts[0].address;

    // Normalize the path
    const normalizedPath = normalizeDirectoryPath(path);
    if (normalizedPath === '') {
        throw new Error('Invalid directory path');
    }

    // Import required modules
    const { Registry } = await import('@cosmjs/proto-signing');
    const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
    const { MsgCreateDirectory } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

    // Create a registry with your custom message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        ['/osdblockchain.osdblockchain.v1.MsgCreateDirectory', MsgCreateDirectory as any]
    ]);

    // Connect to RPC
    let rpcEndpoint = 'https://storage.datavault.space/rpc';
    // Uncomment if running locally:
    // rpcEndpoint = 'http://localhost:26667';

    // Create signing client with the registry
    const signingClient = await SigningStargateClient.connectWithSigner(
        rpcEndpoint,
        offlineSigner,
        { registry }
    );

    // Query account to get current sequence number
    const account = await signingClient.getAccount(userAddress);
    if (!account) {
        throw new Error('Account not found');
    }

    console.log('Current account sequence:', account.sequence);

    // Create message using the generated type
    const msg = {
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgCreateDirectory',
        value: MsgCreateDirectory.fromPartial({
            owner: userAddress,
            path: normalizedPath
        })
    };

    // Send transaction
    const fee = {
        amount: [{ denom: "stake", amount: "0" }],
        gas: '200000'
    };

    console.log('Broadcasting CreateDirectory transaction with sequence:', account.sequence);
    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        fee,
        'Create directory on blockchain'
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    // Extract createdAt from transaction response
    let createdAt = 0;

    try {
        // Wait for transaction to be included in a block
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Query the transaction to get the response
        const txQuery = await signingClient.getTx(result.transactionHash);
        
        if (txQuery && txQuery.events) {
            // Find the "create_directory" event which contains directory information
            // Try different event type formats
            const createDirectoryEvent = txQuery.events.find((event: any) => 
                event.type === 'create_directory' || 
                event.type === 'osdblockchain.osdblockchain.v1.create_directory' ||
                event.type?.includes('create_directory')
            );
            
            if (createDirectoryEvent && createDirectoryEvent.attributes) {
                // Parse attributes to extract createdAt
                for (const attr of createDirectoryEvent.attributes) {
                    const key = typeof attr.key === 'string' 
                        ? attr.key 
                        : (attr.key ? new TextDecoder().decode(attr.key) : '');
                    const value = typeof attr.value === 'string' 
                        ? attr.value 
                        : (attr.value ? new TextDecoder().decode(attr.value) : '');
                    
                    // Try both snake_case and camelCase
                    if (key === 'created_at' || key === 'createdAt') {
                        createdAt = parseInt(value, 10);
                        break;
                    }
                }
            }
        }
    } catch (error) {
        throw new Error(`Failed to extract createdAt from transaction response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
        transactionHash: result.transactionHash || '',
        createdAt: createdAt
    };
}

