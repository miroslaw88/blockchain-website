// Delete directory transaction to blockchain

import { getKeplr, CHAIN_ID } from './utils';

export interface DeleteDirectoryResult {
    transactionHash: string;
    deletedAt: number;
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

export async function deleteDirectory(path: string): Promise<DeleteDirectoryResult> {
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
    if (normalizedPath === '' || normalizedPath === '/') {
        throw new Error('Cannot delete root directory');
    }

    // Import required modules
    const { Registry } = await import('@cosmjs/proto-signing');
    const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
    const { MsgDeleteDirectory } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

    // Create a registry with your custom message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        ['/osdblockchain.osdblockchain.v1.MsgDeleteDirectory', MsgDeleteDirectory as any]
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
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgDeleteDirectory',
        value: MsgDeleteDirectory.fromPartial({
            owner: userAddress,
            path: normalizedPath
        })
    };

    // Send transaction
    const fee = {
        amount: [{ denom: "stake", amount: "0" }],  // Fees = 0
        gas: '200000'
    };

    console.log('Broadcasting delete directory transaction with sequence:', account.sequence);
    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        fee,
        'Delete directory from blockchain'
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    console.log('Delete directory transaction successful:', result.transactionHash);

    return {
        transactionHash: result.transactionHash,
        deletedAt: Math.floor(Date.now() / 1000)
    };
}

