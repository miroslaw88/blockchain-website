// Faucet functionality - Get test tokens

import { fetchWithTimeout } from './fetchFiles/utils';

export interface FaucetResult {
    success: boolean;
    message?: string;
    tx_hash?: string;
    error?: string;
}

/**
 * Request tokens from the faucet
 * @param address - Wallet address to receive tokens
 * @param amount - Amount of tokens to request (default: "1000000")
 * @returns FaucetResult with success status and transaction hash or error
 */
export async function requestTokensFromFaucet(
    address: string,
    amount: string = "1000000"
): Promise<FaucetResult> {
    try {
        // Determine the faucet URL - use the same base as the storage endpoint
        // The faucet endpoint is at /faucet on the same domain
        const faucetUrl = 'https://storage.datavault.space/faucet';
        
        console.log('Requesting tokens from faucet:', { address, amount, url: faucetUrl });
        
        // Use fetchWithTimeout with POST method - it automatically adds Accept header
        // We also need to explicitly set Content-Type for JSON POST requests
        const response = await fetchWithTimeout(faucetUrl, 15000, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                address: address,
                amount: amount
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            let errorMessage = `HTTP error! status: ${response.status}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorText;
            } catch {
                errorMessage = errorText || `HTTP error! status: ${response.status}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // Validate response structure
        if (data.success === true) {
            return {
                success: true,
                message: data.message || 'Tokens sent successfully',
                tx_hash: data.tx_hash
            };
        } else {
            return {
                success: false,
                error: data.error || data.message || 'Unknown error from faucet'
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens from faucet';
        console.error('Faucet request error:', error);
        return {
            success: false,
            error: errorMessage
        };
    }
}

