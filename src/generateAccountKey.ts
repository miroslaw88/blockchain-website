// Generate account key on blockchain

import { getKeplr, CHAIN_ID } from './utils';

export interface GenerateAccountKeyResult {
    success: boolean;
    transactionHash?: string;
    encryptedAccountKey?: string;
    publicKey?: string;
    error?: string;
}

export async function generateAccountKey(): Promise<GenerateAccountKeyResult> {
    try {
        const keplr = getKeplr();
        if (!keplr) {
            throw new Error('Keplr wallet not installed');
        }

        // Ensure chain is enabled
        await keplr.enable(CHAIN_ID);
        const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
        const accounts = await offlineSigner.getAccounts();
        const userAddress = accounts[0].address;

        // Import required modules
        const { Registry } = await import('@cosmjs/proto-signing');
        const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
        const { MsgGenerateAccountKey } = await import('./generated/osdblockchain/osdblockchain/v1/tx');

        // Register message type
        const registry = new Registry([
            ...defaultRegistryTypes,
            ['/osdblockchain.osdblockchain.v1.MsgGenerateAccountKey', MsgGenerateAccountKey as any]
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
            typeUrl: '/osdblockchain.osdblockchain.v1.MsgGenerateAccountKey',
            value: MsgGenerateAccountKey.fromPartial({
                owner: userAddress
            })
        };

        // Set fee
        const fee = {
            amount: [{ denom: 'stake', amount: '0' }],
            gas: '200000'
        };

        // Sign and broadcast
        const result = await signingClient.signAndBroadcast(userAddress, [msg], fee);

        if (result.code === 0) {
            console.log('✅ Account key generated successfully!');
            console.log('Transaction hash:', result.transactionHash);

            // Query the key to get encrypted_account_key and public_key
            const apiEndpoint = 'https://storage.datavault.space';
            const keyResponse = await fetch(
                `${apiEndpoint}/osd-blockchain/osdblockchain/v1/account/${userAddress}/key`
            );

            if (keyResponse.ok) {
                const keyData = await keyResponse.json();
                return {
                    success: true,
                    encryptedAccountKey: keyData.encrypted_account_key || keyData.encryptedAccountKey,
                    publicKey: keyData.public_key || keyData.publicKey,
                    transactionHash: result.transactionHash
                };
            }

            return {
                success: true,
                transactionHash: result.transactionHash
            };
        } else {
            throw new Error(`Transaction failed: ${result.rawLog}`);
        }
    } catch (error) {
        console.error('❌ Error generating account key:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

