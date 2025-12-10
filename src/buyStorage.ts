// Buy storage on blockchain

import { getKeplr, CHAIN_ID } from './utils';

export async function buyStorage(storageBytes: number, durationDays: number, payment: string): Promise<string> {
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
    const { MsgBuyStorage } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

    // Register message type
    const registry = new Registry([
        ...defaultRegistryTypes,
        ['/osdblockchain.osdblockchain.v1.MsgBuyStorage', MsgBuyStorage as any]
    ]);

    // Connect to RPC
    let rpcEndpoint = 'https://storage.datavault.space/rpc';
    // Uncomment if running locally:
    // rpcEndpoint = 'http://localhost:26667';

    // Create client
    const signingClient = await SigningStargateClient.connectWithSigner(
        rpcEndpoint,
        offlineSigner,
        { registry }
    );

    // Create message
    const msg = {
        typeUrl: '/osdblockchain.osdblockchain.v1.MsgBuyStorage',
        value: MsgBuyStorage.fromPartial({
            buyer: userAddress,
            bytes: storageBytes,
            payment: payment,  // e.g., "0.1stake"
            duration: durationDays
        })
    };

    // Send transaction
    const result = await signingClient.signAndBroadcast(
        userAddress,
        [msg],
        {
            amount: [{ denom: 'stake', amount: '0' }],
            gas: '200000'
        }
    );

    if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
    }

    return result.transactionHash;
}

