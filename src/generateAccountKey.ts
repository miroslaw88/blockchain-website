// Upload ECIES public key to blockchain

import { getKeplr, CHAIN_ID } from './utils';
import { generateECIESKeypair } from './osd-blockchain-sdk';

export interface UploadECIESPublicKeyResult {
    success: boolean;
    transactionHash?: string;
    publicKey?: string;
    error?: string;
}

/**
 * Generate an ECIES keypair locally and upload the public key to the blockchain
 * The private key is stored in sessionStorage for decryption
 */
export async function uploadECIESPublicKey(): Promise<UploadECIESPublicKeyResult> {
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

        // Generate ECIES keypair locally
        console.log('Generating ECIES keypair...');
        const { privateKeyHex, publicKeyHex } = await generateECIESKeypair();
        
        // Debug: Log key details
        console.log('Generated private key length (hex):', privateKeyHex.length);
        console.log('Generated public key length (hex):', publicKeyHex.length);
        console.log('Generated public key (first 20 chars):', publicKeyHex.substring(0, 20));
        console.log('Generated public key (last 20 chars):', publicKeyHex.substring(publicKeyHex.length - 20));
        
        // Validate public key is not empty
        if (!publicKeyHex || publicKeyHex.length === 0) {
            throw new Error('Generated ECIES public key is empty');
        }
        
        // Store private key in localStorage for decryption (persists across sessions)
        localStorage.setItem(`ecies_private_key_${userAddress}`, privateKeyHex);
        console.log('ECIES private key stored in localStorage');

        // Import required modules
        const { Registry } = await import('@cosmjs/proto-signing');
        const { SigningStargateClient, defaultRegistryTypes } = await import('@cosmjs/stargate');
        
        // Try to import MsgPostKey, if it doesn't exist, we'll create a generic message
        let MsgPostKey: any;
        try {
            const txModule = await import('./generated/osdblockchain/osdblockchain/v1/tx');
            MsgPostKey = txModule.MsgPostKey;
        } catch (error) {
            // If MsgPostKey doesn't exist in generated types, create a generic message structure
            console.warn('MsgPostKey not found in generated types, using generic message structure');
            MsgPostKey = null;
        }

        // Register message type
        const registryTypes: Array<[string, any]> = [...defaultRegistryTypes];
        if (MsgPostKey) {
            registryTypes.push(['/osdblockchain.osdblockchain.v1.MsgPostKey', MsgPostKey as any]);
        }
        const registry = new Registry(registryTypes);

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
        // The field name in the generated types is eciesPublicKey (camelCase), not ecies_public_key
        if (!MsgPostKey) {
            throw new Error('MsgPostKey not found in generated types. Please regenerate protobuf types.');
        }
        
        const msgValue = MsgPostKey.fromPartial({
            owner: userAddress,
            eciesPublicKey: publicKeyHex  // Note: camelCase, not snake_case
        });
        
        // Debug: Verify the message value
        console.log('Message value owner:', msgValue.owner);
        console.log('Message value eciesPublicKey length:', msgValue.eciesPublicKey?.length || 0);
        console.log('Message value eciesPublicKey (first 20 chars):', msgValue.eciesPublicKey?.substring(0, 20) || 'empty');
        
        // Final validation before sending
        if (!msgValue.eciesPublicKey || msgValue.eciesPublicKey.length === 0) {
            throw new Error('ECIES public key is empty in message. Cannot send transaction.');
        }
        
        const msg = {
            typeUrl: '/osdblockchain.osdblockchain.v1.MsgPostKey',
            value: msgValue
        };

        // Log the payload before sending
        console.log('=== ECIES Public Key Upload Payload ===');
        console.log('Payload:', JSON.stringify({
            typeUrl: msg.typeUrl,
            value: {
                owner: msgValue.owner,
                eciesPublicKey: msgValue.eciesPublicKey
            }
        }, null, 2));
        console.log('Full message value:', msgValue);

        // Set fee
        const fee = {
            amount: [{ denom: 'stake', amount: '0' }],
            gas: '200000'
        };

        // Sign and broadcast
        console.log('Signing and broadcasting transaction...');
        const result = await signingClient.signAndBroadcast(userAddress, [msg], fee, 'Upload ECIES Public Key');

        if (result.code === 0) {
            console.log('✅ ECIES public key uploaded successfully!');
            console.log('Transaction hash:', result.transactionHash);
            console.log('Public key (first 20 chars):', publicKeyHex.substring(0, 20) + '...');

            return {
                success: true,
                transactionHash: result.transactionHash,
                publicKey: publicKeyHex
            };
        } else {
            throw new Error(`Transaction failed: ${result.rawLog}`);
        }
    } catch (error) {
        console.error('❌ Error uploading ECIES public key:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Keep the old function name for backwards compatibility (but it now calls uploadECIESPublicKey)
export async function generateAccountKey(): Promise<UploadECIESPublicKeyResult> {
    return uploadECIESPublicKey();
}

