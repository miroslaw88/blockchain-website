// Fetch files from blockchain

// Fetch with timeout helper
async function fetchWithTimeout(url: string, timeout: number = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeout}ms. The server may be unreachable or taking too long to respond.`);
        }
        throw error; 
    }
}

// Fetch files from blockchain
export async function fetchFiles(walletAddress: string): Promise<void> {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;

    // Show loading state
    contentArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div><p class="mt-2">Loading files...</p><p class="text-muted small">This may take a few seconds...</p></div>';

    try {
        // Construct API URL with wallet address
        // Use HTTPS through Caddy reverse proxy (routes /osd-blockchain to localhost:1337)
        const apiEndpoint = 'https://storage.datavault.space';
        const apiUrl = `${apiEndpoint}/osd-blockchain/osdblockchain/v1/files/owner/${walletAddress}`;
        
        console.log('Fetching from:', apiUrl);
        
        // Fetch data from blockchain with 15 second timeout
        const response = await fetchWithTimeout(apiUrl, 15000);
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            let errorMessage = `HTTP error! status: ${response.status}`;
            
            // Try to parse error response
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.code === 12 || response.status === 501) {
                    errorMessage = `Not Implemented (code 12): The endpoint may not be implemented or Caddy is not routing correctly.`;
                    errorMessage += `\n\nTried: ${apiUrl}`;
                    errorMessage += `\n\nCheck:`;
                    errorMessage += `\n1. Caddyfile has route: handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }`;
                    errorMessage += `\n2. Test directly: curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}`;
                    errorMessage += `\n3. Verify blockchain API server implements this endpoint`;
                } else {
                    errorMessage = `HTTP error! status: ${response.status}, code: ${errorJson.code || 'N/A'}, message: ${errorJson.message || errorText}`;
                }
            } catch {
                errorMessage = `HTTP error! status: ${response.status}, message: ${errorText}`;
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // Display formatted JSON
        contentArea.innerHTML = `
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Files for ${walletAddress}</h5>
                    <small class="text-muted">Endpoint: ${apiEndpoint}</small>
                </div>
                <div class="card-body">
                    <pre class="bg-light p-3 rounded" style="max-height: 70vh; overflow: auto;"><code id="jsonContent">${JSON.stringify(data, null, 2)}</code></pre>
                </div>
            </div>
        `;
    } catch (error) {
        // Display detailed error
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch files';
        console.error('Fetch error:', error);
        
        contentArea.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <h5 class="alert-heading">Error Fetching Files</h5>
                <p><strong>Error:</strong> ${errorMessage}</p>
                <hr>
                <p class="mb-1"><strong>Troubleshooting:</strong></p>
                <ul class="mb-0">
                    <li><strong>Code 12 / Status 501:</strong> This usually means Caddy isn't routing the request to your blockchain API server. Check your Caddyfile configuration.</li>
                    <li>Ensure your blockchain node is running on <code>localhost:1337</code></li>
                    <li>Verify Caddyfile has: <code>handle_path /osd-blockchain* { reverse_proxy 127.0.0.1:1337 }</code></li>
                    <li>Test the endpoint directly: <code>curl http://localhost:1337/osd-blockchain/osdblockchain/v1/files/owner/{address}</code></li>
                    <li>Reload Caddy after config changes: <code>sudo systemctl reload caddy</code></li>
                    <li>Check Caddy logs: <code>sudo journalctl -u caddy -f</code></li>
                </ul>
            </div>
        `;
    }
}

