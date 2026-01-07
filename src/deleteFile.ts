// Delete file transaction to blockchain

import { getKeplr, CHAIN_ID } from './utils';

export interface DeleteFileResult {
    transactionHash: string;
    deletedAt: number;
    deletedCount: number;
}

export async function deleteFile(merkleRoots: string[]): Promise<DeleteFileResult> {
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
    const { MsgDeleteFile } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

    // Create a registry with your custom message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        ['/osdblockchain.osdblockchain.v1.MsgDeleteFile', MsgDeleteFile as any]
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
    // The generated type uses merkleRoots (array) - check the generated types
    const msg = {
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgDeleteFile',
        value: MsgDeleteFile.fromPartial({
            owner: userAddress,
            merkleRoots: merkleRoots
        })
    };

    // Send transaction
    // Increase gas for multiple files (200000 base + 50000 per additional file)
    const gasAmount = 200000 + (merkleRoots.length - 1) * 50000;
    const fee = {
        amount: [{ denom: "stake", amount: "0" }],  // Fees = 0
        gas: gasAmount.toString()
    };

    console.log(`Broadcasting delete ${merkleRoots.length} file(s) transaction with sequence:`, account.sequence);
    console.log('Merkle roots to delete:', merkleRoots);
    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        fee,
        `Delete ${merkleRoots.length} file(s) from blockchain`
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    console.log('Delete file transaction successful:', result.transactionHash);
    
    // Parse response to get deleted_count
    // The response events should contain deleted_count
    let deletedCount = merkleRoots.length; // Default to number of files we tried to delete
    try {
        // Try to extract deleted_count from events
        if (result.events) {
            for (const event of result.events) {
                if (event.type === 'delete_file' || event.type === 'osdblockchain.osdblockchain.v1.EventDeleteFile') {
                    const deletedCountAttr = event.attributes?.find((attr: any) => 
                        attr.key === 'deleted_count' || attr.key === 'deletedCount'
                    );
                    if (deletedCountAttr) {
                        deletedCount = parseInt(deletedCountAttr.value, 10);
                        break;
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Could not parse deleted_count from response, using default:', e);
    }

    return {
        transactionHash: result.transactionHash,
        deletedAt: Math.floor(Date.now() / 1000),
        deletedCount: deletedCount
    };
}

