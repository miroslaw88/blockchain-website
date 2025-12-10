// Keplr wallet connection handler
export namespace Wallet {
    interface KeplrWindow extends Window {
        keplr?: {
            enable: (chainId: string) => Promise<void>;
            suggestChain?: (chainInfo: any) => Promise<void>;
            experimentalSuggestChain?: (chainInfo: any) => Promise<void>;
            getKey: (chainId: string) => Promise<{
                name: string;
                algo: string;
                pubKey: Uint8Array;
                address: Uint8Array;
                bech32Address: string;
            }>;
        };
    }

    // OSD Blockchain configuration
    const CHAIN_ID = 'osdblockchain';
    
    const chainInfo = {
        chainId: CHAIN_ID,
        chainName: "OSD Blockchain",
        rpc: "https://storage.datavault.space/rpc",
        rest: "https://storage.datavault.space/rest",
        bip44: {
            coinType: 118, // Same as Cosmos Hub
        },
        bech32Config: {
            bech32PrefixAccAddr: "cosmos",
            bech32PrefixAccPub: "cosmospub",
            bech32PrefixValAddr: "cosmosvaloper",
            bech32PrefixValPub: "cosmosvaloperpub",
            bech32PrefixConsAddr: "cosmosvalcons",
            bech32PrefixConsPub: "cosmosvalconspub",
        },
        currencies: [
            {
                coinDenom: "STAKE",
                coinMinimalDenom: "stake",
                coinDecimals: 6,
                coinGeckoId: undefined,
            },
        ],
        feeCurrencies: [
            {
                coinDenom: "STAKE",
                coinMinimalDenom: "stake",
                coinDecimals: 6,
                coinGeckoId: undefined,
            },
        ],
        stakeCurrency: {
            coinDenom: "STAKE",
            coinMinimalDenom: "stake",
            coinDecimals: 6,
            coinGeckoId: undefined,
        },
        coinType: 118,
        gasPriceStep: {
            low: 0.01,
            average: 0.025,
            high: 0.04,
        },
        features: [],
    };

    // Get Keplr instance
    function getKeplr(): KeplrWindow['keplr'] {
        const window = globalThis as unknown as KeplrWindow;
        return window.keplr;
    }

    // Wait for Keplr to be available (extensions inject asynchronously)
    async function waitForKeplr(timeout = 3000): Promise<KeplrWindow['keplr']> {
    return new Promise((resolve) => {
        // Check immediately first
        const keplr = getKeplr();
        if (keplr) {
            resolve(keplr);
            return;
        }

        // Wait a bit before starting to poll (let extension scripts initialize)
        setTimeout(() => {
            const keplr = getKeplr();
            if (keplr) {
                resolve(keplr);
                return;
            }

            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                const keplr = getKeplr();
                if (keplr) {
                    clearInterval(checkInterval);
                    resolve(keplr);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    resolve(undefined);
                }
            }, 200);
        }, 500);
    });
    }

    // Connect wallet function
    async function connectWallet(): Promise<void> {
    const $connectBtn = $('#connectBtn');
    const $btnText = $('#btnText');
    const $btnSpinner = $('#btnSpinner');
    const $walletStatus = $('#walletStatus');
    const $statusContent = $('#statusContent');

    // Show loading state
    $connectBtn.prop('disabled', true);
    $btnSpinner.removeClass('d-none');
    $btnText.text('Connecting...');
    $walletStatus.attr('class', 'wallet-status');
    $statusContent.empty();

    try {
        // Wait for Keplr to be available
        const keplr = await waitForKeplr();
        if (!keplr) {
            throw new Error('Keplr wallet is not installed. Please install it from https://www.keplr.app/');
        }

        // Try to enable the chain first (in case it's already added)
        let chainEnabled = false;
        try {
            await keplr.enable(CHAIN_ID);
            chainEnabled = true;
        } catch (enableError) {
            // Chain not enabled, need to suggest it first
            // Suggest the chain to Keplr (this will add it if not already added)
            // Try suggestChain first, then fallback to experimentalSuggestChain
            try {
                if (keplr.suggestChain) {
                    await keplr.suggestChain(chainInfo);
                } else if (keplr.experimentalSuggestChain) {
                    await keplr.experimentalSuggestChain(chainInfo);
                } else {
                    throw new Error('Keplr does not support chain suggestion. Please add the chain manually in Keplr settings.');
                }
                
                // After suggesting, try to enable again
                await keplr.enable(CHAIN_ID);
                chainEnabled = true;
            } catch (suggestError) {
                // If suggestChain fails, try experimentalSuggestChain as fallback
                if (keplr.experimentalSuggestChain && !keplr.suggestChain) {
                    try {
                        await keplr.experimentalSuggestChain(chainInfo);
                        await keplr.enable(CHAIN_ID);
                        chainEnabled = true;
                    } catch (expError) {
                        const errorMsg = expError instanceof Error ? expError.message : 'Unknown error';
                        throw new Error(`Failed to add chain to Keplr: ${errorMsg}. Please add "osdblockchain" manually in Keplr settings.`);
                    }
                } else {
                    const errorMsg = suggestError instanceof Error ? suggestError.message : 'Unknown error';
                    throw new Error(`Failed to add chain to Keplr: ${errorMsg}. Please add "osdblockchain" manually in Keplr settings.`);
                }
            }
        }

        if (!chainEnabled) {
            throw new Error('Failed to enable chain in Keplr');
        }

        // Get wallet information
        const key = await keplr.getKey(CHAIN_ID);

        // Store wallet info in sessionStorage
        sessionStorage.setItem('walletConnected', 'true');
        sessionStorage.setItem('walletAddress', key.bech32Address);
        sessionStorage.setItem('walletName', key.name);
        sessionStorage.setItem('chainId', CHAIN_ID);

        // Initialize ECIES key material right after wallet connection
        // This ensures the key is cached before any file operations
        try {
            // Import the deriveECIESPrivateKey function
            const { deriveECIESPrivateKey } = await import('./utils');
            await deriveECIESPrivateKey(key.bech32Address);
            console.log('ECIES key material initialized and cached during wallet connection');
        } catch (error) {
            console.warn('Failed to initialize ECIES key during wallet connection:', error);
            // Don't block wallet connection if this fails - it will be initialized on first use
        }

        // Switch to dashboard view (no redirect)
        const { switchToDashboard } = await import('./app');
        switchToDashboard();

    } catch (error) {
        // Display error status
        $walletStatus.addClass('error');
        const errorMessage = error instanceof Error ? error.message : 'Failed to connect wallet';
        $statusContent.html(`
            <p class="mb-0"><strong>Error:</strong> ${errorMessage}</p>
        `);

        // Reset button
        $btnText.text('Connect Wallet');
        $connectBtn.prop('disabled', false);
    } finally {
        $btnSpinner.addClass('d-none');
    }
    }

    // Suppress Keplr extension errors (known issue with file:// protocol)
    window.addEventListener('error', (event) => {
    // Suppress Keplr extension errors that occur on page load
    if (event.message && event.message.includes('postMessage') && 
        event.filename && event.filename.includes('moz-extension')) {
        event.preventDefault();
        return false;
    }
    }, true);

    // Suppress unhandled promise rejections from Keplr
    window.addEventListener('unhandledrejection', (event) => {
    // Suppress Keplr extension promise rejections
    if (event.reason && event.reason.message && 
        event.reason.message.includes('postMessage')) {
        event.preventDefault();
        return false;
    }
    });

    // Reset button state (called when switching to wallet connection view)
    function resetButtonState(): void {
        $('#connectBtn').prop('disabled', false);
        $('#btnText').text('Connect Wallet');
        $('#btnSpinner').addClass('d-none');
        $('#walletStatus').attr('class', 'wallet-status').css('display', 'none');
        $('#statusContent').empty();
    }

    // Track if initialized to prevent duplicate event listeners
    let walletInitialized = false;

    // Initialize on page load
    export function init() {
    // Reset button state first (in case we're switching back from dashboard)
    resetButtonState();
    
    // Prevent duplicate event listeners
    if (walletInitialized) {
        return;
    }
    walletInitialized = true;
    
    $('#connectBtn').on('click', connectWallet);

    // Check if page is loaded via file:// protocol and show warning
    if (window.location.protocol === 'file:') {
        $('#walletStatus').addClass('error').css('display', 'block');
        $('#statusContent').html(`
            <p class="mb-2"><strong>Warning:</strong> This page is being loaded from a file:// URL.</p>
            <p class="mb-0">For best compatibility with Keplr, please use a local server. Run: <code>npm run serve</code></p>
        `);
    }
    // Don't check for Keplr on page load to avoid triggering extension scripts prematurely
    // The check will happen when user clicks the connect button
    }
}

// Initialize on page load
$(document).ready(() => {
    Wallet.init();
});

