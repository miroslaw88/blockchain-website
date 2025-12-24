# OSD Blockchain Web Interface - API Documentation

This document provides comprehensive documentation for replicating the core functions of the OSD Blockchain web interface. It covers setup, development workflow, API functions, and implementation details.

## Table of Contents

1. [Setup & Installation](#setup--installation)
2. [Development Workflow](#development-workflow)
3. [Project Structure](#project-structure)
4. [Core API Functions](#core-api-functions)
5. [Blockchain Integration](#blockchain-integration)
6. [Storage Provider Integration](#storage-provider-integration)
7. [File Encryption & Hashing](#file-encryption--hashing)
8. [Configuration](#configuration)
9. [Code Examples](#code-examples)

---

## Setup & Installation

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn package manager
- Keplr wallet browser extension installed
- Access to OSD Blockchain RPC and REST endpoints

### Installation Steps

1. **Clone or initialize the project:**
   ```bash
   npm init -y
   ```

2. **Install dependencies:**
   ```bash
   npm install @keplr-wallet/types @cosmjs/stargate @cosmjs/proto-signing @cosmjs/tendermint-rpc
   npm install buffer crypto-browserify stream-browserify
   npm install --save-dev typescript @types/node vite vite-plugin-node-polyfills
   ```

3. **Project dependencies (package.json):**
   ```json
   {
     "dependencies": {
       "@keplr-wallet/types": "^0.12.0",
       "@cosmjs/stargate": "^0.32.4",
       "@cosmjs/proto-signing": "^0.32.4",
       "@cosmjs/tendermint-rpc": "^0.32.2",
       "buffer": "^6.0.3",
       "crypto-browserify": "^3.12.0",
       "stream-browserify": "^3.0.0"
     },
     "devDependencies": {
       "typescript": "^5.3.3",
       "@types/node": "^20.10.5",
       "vite": "^5.0.0",
       "vite-plugin-node-polyfills": "^0.17.0"
     }
   }
   ```

---

## Development Workflow

### Available Scripts

- **`npm run dev`** - Start development server with hot reload
  - Runs Vite dev server on `http://localhost:8080`
  - Automatically opens browser
  - Supports hot module replacement

- **`npm run build`** - Build for production
  - Compiles TypeScript and bundles assets
  - Outputs to `dist/` directory
  - Creates optimized production build

- **`npm run preview`** - Preview production build locally
  - Serves the built files from `dist/`
  - Useful for testing production build

- **`npm run build:ts`** - TypeScript compilation only
  - Compiles TypeScript without bundling

- **`npm run watch`** - Watch mode for TypeScript
  - Continuously compiles TypeScript on file changes

### Development Server

The development server runs on port 8080 by default. Configuration is in `vite.config.ts`:

```typescript
server: {
  port: 8080,
  open: true
}
```

---

## Project Structure

```
website/
├── index.html              # Wallet connection page
├── dashboard.html          # Main dashboard page
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite bundler configuration
├── src/
│   ├── wallet.ts           # Keplr wallet connection
│   ├── dashboard.ts        # Dashboard UI and file upload
│   ├── utils.ts            # Shared utilities
│   ├── fetchFiles.ts       # Fetch files from blockchain
│   ├── buyStorage.ts       # Purchase storage transaction
│   ├── postFile.ts         # Post file metadata to blockchain
│   └── generated/          # Generated protobuf types
└── dist/                   # Production build output
```

---

## Core API Functions

### 1. Wallet Connection (`src/wallet.ts`)

#### `Wallet.connectWallet()`

Connects to Keplr wallet and enables the OSD Blockchain chain.

**Process:**
1. Waits for Keplr extension to be available
2. Suggests chain configuration to Keplr (if not already added)
3. Enables the chain
4. Retrieves wallet address and stores in sessionStorage
5. Redirects to dashboard

**Chain Configuration:**
```typescript
const chainInfo = {
  chainId: 'osdblockchain',
  chainName: "OSD Blockchain",
  rpc: "https://storage.datavault.space/rpc",
  rest: "https://storage.datavault.space/rest",
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "cosmos",
    bech32PrefixAccPub: "cosmospub",
    bech32PrefixValAddr: "cosmosvaloper",
    bech32PrefixValPub: "cosmosvaloperpub",
    bech32PrefixConsAddr: "cosmosvalcons",
    bech32PrefixConsPub: "cosmosvalconspub",
  },
  currencies: [{
    coinDenom: "STAKE",
    coinMinimalDenom: "stake",
    coinDecimals: 6,
  }],
  feeCurrencies: [{
    coinDenom: "STAKE",
    coinMinimalDenom: "stake",
    coinDecimals: 6,
  }],
  stakeCurrency: {
    coinDenom: "STAKE",
    coinMinimalDenom: "stake",
    coinDecimals: 6,
  },
  coinType: 118,
  gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
  features: [],
};
```

**Session Storage:**
- `walletConnected`: "true"
- `walletAddress`: Bech32 address
- `walletName`: Wallet name
- `chainId`: "osdblockchain"

---

### 2. Fetch Files (`src/fetchFiles.ts`)

#### `fetchFiles(walletAddress: string): Promise<void>`

Fetches files owned by a wallet address from the blockchain.

**Endpoint:**
```
GET https://storage.datavault.space/osd-blockchain/osdblockchain/v1/files/owner/{walletAddress}
```

**Implementation:**
```typescript
export async function fetchFiles(walletAddress: string): Promise<void> {
  const apiEndpoint = 'https://storage.datavault.space';
  const apiUrl = `${apiEndpoint}/osd-blockchain/osdblockchain/v1/files/owner/${walletAddress}`;
  
  const response = await fetchWithTimeout(apiUrl, 15000);
  const data = await response.json();
  
  // Display formatted JSON
  // ...
}
```

**Response Format:**
Returns JSON array of file metadata objects.

---

### 3. Buy Storage (`src/buyStorage.ts`)

#### `buyStorage(storageBytes: number, durationDays: number, payment: string): Promise<string>`

Purchases storage on the blockchain.

**Parameters:**
- `storageBytes`: Storage size in bytes (e.g., 1000000000 for 1GB)
- `durationDays`: Subscription duration in days
- `payment`: Payment amount as string (e.g., "0.1stake")

**Returns:** Transaction hash string

**Message Type:**
```
/osdblockchain.osdblockchain.v1.MsgBuyStorage
```

**Message Structure:**
```typescript
{
  buyer: string,        // User's bech32 address
  bytes: number,        // Storage size in bytes
  payment: string,      // Payment amount (e.g., "0.1stake")
  duration: number     // Duration in days
}
```

**Transaction Fee:**
```typescript
{
  amount: [{ denom: 'stake', amount: '0' }],
  gas: '200000'
}
```

---

### 4. Post File (`src/postFile.ts`)

#### `postFile(merkleRoot: string, sizeBytes: number, expirationTime: number, maxProofs: number, metadata: { name: string, content_type: string }): Promise<PostFileResult>`

Posts file metadata to the blockchain and receives storage provider assignments.

**Parameters:**
- `merkleRoot`: SHA256 hash of encrypted file (hex string)
- `sizeBytes`: Size of encrypted file in bytes
- `expirationTime`: Unix timestamp (seconds) when file expires
- `maxProofs`: Maximum number of storage proofs allowed
- `metadata`: Object with `name` and `content_type` (JSON stringified)

**Returns:**
```typescript
interface PostFileResult {
  transactionHash: string;
  providers: StorageProvider[];
  primaryProviderIndex: number;
}
```

**Message Type:**
```
/osdblockchain.osdblockchain.v1.MsgPostFile
```

**Message Structure:**
```typescript
{
  owner: string,           // User's bech32 address
  merkleRoot: string,      // SHA256 hash (hex)
  sizeBytes: number,      // File size in bytes
  expirationTime: number,  // Unix timestamp
  maxProofs: number,      // Max proofs
  metadata: string        // JSON stringified metadata
}
```

**Transaction Fee:**
```typescript
{
  amount: [{ denom: "stake", amount: "0" }],
  gas: '2000000'
}
```

**Provider Extraction:**
After transaction is broadcast, query the transaction to extract storage providers from events:
- Event type: `post_file`
- Attributes: `provider_0_id`, `provider_0_address`, `provider_1_id`, etc.

---

### 5. File Upload (`src/dashboard.ts`)

#### `uploadFile(file: File): Promise<void>`

Complete file upload workflow:

1. **Encrypt file** using user's wallet signature
2. **Calculate merkle root** from encrypted file data
3. **Post file metadata** to blockchain
4. **Upload encrypted file** to storage provider

**Upload Flow:**
```typescript
async function uploadFile(file: File): Promise<void> {
  // 1. Connect to Keplr and get user address
  const keplr = getKeplr();
  await keplr.enable(CHAIN_ID);
  const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const userAddress = accounts[0].address;

  // 2. Encrypt file
  const encryptedFile = await encryptFile(file, userAddress);

  // 3. Calculate merkle root from encrypted file
  const encryptedData = await encryptedFile.arrayBuffer();
  const merkleRoot = await calculateMerkleRoot(encryptedData);

  // 4. Post file to blockchain
  const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
  const postFileResult = await postFile(
    merkleRoot,
    encryptedFile.size,
    expirationTime,
    3,
    { name: file.name, content_type: file.type || 'application/octet-stream' }
  );

  // 5. Upload to storage provider
  if (postFileResult.providers.length > 0) {
    const provider = postFileResult.providers[postFileResult.primaryProviderIndex];
    await uploadToStorageProvider(
      provider.providerAddress,
      encryptedFile,
      merkleRoot,
      userAddress,
      expirationTime,
      { name: file.name, content_type: file.type || 'application/octet-stream' }
    );
  }
}
```

---

## Blockchain Integration

### RPC Endpoint

**Production:**
```
https://storage.datavault.space/rpc
```

**Local Development:**
```
http://localhost:26667
```

### REST API Endpoint

**Production:**
```
https://storage.datavault.space/rest
```

**Local Development:**
```
http://localhost:1317
```

### Creating Signing Client

```typescript
import { Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient, defaultRegistryTypes } from '@cosmjs/stargate';

// Register custom message types
const registry = new Registry([
  ...defaultRegistryTypes,
  ['/osdblockchain.osdblockchain.v1.MsgBuyStorage', MsgBuyStorage as any],
  ['/osdblockchain.osdblockchain.v1.MsgPostFile', MsgPostFile as any]
]);

// Create signing client
const signingClient = await SigningStargateClient.connectWithSigner(
  rpcEndpoint,
  offlineSigner,
  { registry }
);
```

### Broadcasting Transactions

```typescript
const result = await signingClient.signAndBroadcast(
  userAddress,
  [msg],
  fee,
  memo // Optional memo
);

if (result.code !== 0) {
  throw new Error(`Transaction failed: ${result.rawLog}`);
}

const transactionHash = result.transactionHash;
```

### Querying Transactions

```typescript
// Wait for transaction to be indexed
await new Promise(resolve => setTimeout(resolve, 1000));

// Query transaction
const txQuery = await signingClient.getTx(transactionHash);

// Extract events
if (txQuery && txQuery.events) {
  const event = txQuery.events.find(e => e.type === 'post_file');
  // Parse event attributes...
}
```

---

## Storage Provider Integration

### Upload Endpoint

**Production:**
```
POST https://storage.datavault.space/api/storage/files/upload
```

**Direct (if Caddy not configured):**
```
POST http://{providerAddress}/api/storage/files/upload
```

### Upload Request

**Method:** `POST`  
**Content-Type:** `multipart/form-data`

**Form Data Fields:**
- `file`: Encrypted file blob (binary)
- `merkle_root`: SHA256 hash of encrypted file (hex string)
- `owner`: Wallet address (bech32 format)
- `expiration_time`: Unix timestamp (seconds) as string
- `metadata`: JSON stringified metadata object

**Example:**
```typescript
const formData = new FormData();
formData.append('file', encryptedFile, 'encrypted.bin');
formData.append('merkle_root', merkleRoot);
formData.append('owner', userAddress);
formData.append('expiration_time', expirationTime.toString());
formData.append('metadata', JSON.stringify({
  name: file.name,
  content_type: file.type || 'application/octet-stream'
}));

const response = await fetch('https://storage.datavault.space/api/storage/files/upload', {
  method: 'POST',
  body: formData
});
```

**Response:**
- Success: HTTP 200 with JSON response
- Error: HTTP 4xx/5xx with error message

---

## File Encryption & Hashing

### Encryption (`encryptFile`)

**Algorithm:** AES-CBC-256  
**Key Derivation:** PBKDF2 with SHA-256  
**Key Source:** Keplr signature of file hash

**Process:**
1. Calculate SHA256 hash of original file
2. Request signature from Keplr: `signArbitrary(chainId, address, "File encryption: {hash}")`
3. Derive AES key from signature using PBKDF2:
   - Salt: empty (0 bytes)
   - Iterations: 10000
   - Hash: SHA-256
   - Key length: 256 bits
4. Generate random 16-byte IV
5. Encrypt file data with AES-CBC
6. Combine IV + encrypted data into single blob

**Code:**
```typescript
async function encryptFile(file: File, userAddress: string): Promise<Blob> {
  const keplr = getKeplr();
  const fileData = await file.arrayBuffer();
  
  // Create message to sign
  const fileHash = await calculateMerkleRoot(fileData);
  const messageToSign = `File encryption: ${fileHash}`;
  
  // Request signature from Keplr
  const signatureResult = await keplr.signArbitrary(CHAIN_ID, userAddress, messageToSign);
  
  // Derive encryption key from signature
  const signatureBytes = Uint8Array.from(atob(signatureResult.signature), c => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signatureBytes.slice(0, 32),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  // Derive AES key
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(0),
      iterations: 10000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-CBC', length: 256 },
    false,
    ['encrypt']
  );
  
  // Generate IV
  const iv = crypto.getRandomValues(new Uint8Array(16));
  
  // Encrypt
  const encryptedData = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: iv },
    key,
    fileData
  );
  
  // Combine IV + encrypted data
  const combined = new Uint8Array(iv.length + encryptedData.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedData), iv.length);
  
  return new Blob([combined]);
}
```

### Merkle Root Calculation (`calculateMerkleRoot`)

**Algorithm:** SHA-256  
**Input:** Encrypted file data (ArrayBuffer)  
**Output:** Hexadecimal string (lowercase)

**Important:** The merkle root must be calculated from the **encrypted file data**, not the original file, because the storage provider calculates the hash from the encrypted file it receives.

**Code:**
```typescript
async function calculateMerkleRoot(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Storage Provider Implementation (Go):**
```go
func CalculateMerkleRoot(data []byte) string {
    hash := sha256.Sum256(data)
    return hex.EncodeToString(hash[:])
}
```

---

## Configuration

### Vite Configuration (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html',
        dashboard: './dashboard.html'
      },
      output: {
        manualChunks: {
          'cosmjs': ['@cosmjs/stargate', '@cosmjs/proto-signing', '@cosmjs/tendermint-rpc']
        },
        format: 'es'
      }
    },
    commonjsOptions: {
      transformMixedEsModules: true
    },
    chunkSizeWarningLimit: 1000
  },
  server: {
    port: 8080,
    open: true
  },
  optimizeDeps: {
    include: ['@cosmjs/stargate', '@cosmjs/proto-signing', '@cosmjs/tendermint-rpc'],
    esbuildOptions: {
      target: 'es2020'
    }
  },
  define: {
    global: 'globalThis',
  }
});
```

### TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Constants (`src/utils.ts`)

```typescript
export const CHAIN_ID = 'osdblockchain';

export function getKeplr(): KeplrWindow['keplr'] {
  const window = globalThis as unknown as KeplrWindow;
  return window.keplr;
}
```

---

## Code Examples

### Complete File Upload Example

```typescript
import { getKeplr, CHAIN_ID } from './utils';
import { postFile } from './postFile';

async function uploadFile(file: File): Promise<void> {
  // 1. Get Keplr and user address
  const keplr = getKeplr();
  if (!keplr) throw new Error('Keplr not available');
  
  await keplr.enable(CHAIN_ID);
  const offlineSigner = keplr.getOfflineSigner(CHAIN_ID);
  const accounts = await offlineSigner.getAccounts();
  const userAddress = accounts[0].address;

  // 2. Encrypt file
  const encryptedFile = await encryptFile(file, userAddress);

  // 3. Calculate merkle root from encrypted file
  const encryptedData = await encryptedFile.arrayBuffer();
  const merkleRoot = await calculateMerkleRoot(encryptedData);

  // 4. Post to blockchain
  const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30;
  const postFileResult = await postFile(
    merkleRoot,
    encryptedFile.size,
    expirationTime,
    3,
    { name: file.name, content_type: file.type || 'application/octet-stream' }
  );

  // 5. Upload to storage provider
  if (postFileResult.providers.length > 0) {
    const provider = postFileResult.providers[postFileResult.primaryProviderIndex];
    
    const formData = new FormData();
    formData.append('file', encryptedFile, 'encrypted.bin');
    formData.append('merkle_root', merkleRoot);
    formData.append('owner', userAddress);
    formData.append('expiration_time', expirationTime.toString());
    formData.append('metadata', JSON.stringify({
      name: file.name,
      content_type: file.type || 'application/octet-stream'
    }));

    const uploadUrl = `https://storage.datavault.space/api/storage/files/upload`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
  }
}
```

### Buy Storage Example

```typescript
import { buyStorage } from './buyStorage';

async function purchaseStorage() {
  try {
    const txHash = await buyStorage(
      1000000000,  // 1GB in bytes
      30,          // 30 days
      "0.1stake"   // Payment amount
    );
    console.log('Transaction hash:', txHash);
  } catch (error) {
    console.error('Purchase failed:', error);
  }
}
```

### Fetch Files Example

```typescript
import { fetchFiles } from './fetchFiles';

async function loadUserFiles() {
  const walletAddress = sessionStorage.getItem('walletAddress');
  if (walletAddress) {
    await fetchFiles(walletAddress);
  }
}
```

---

## Troubleshooting

### Common Issues

1. **CORS Errors:**
   - Ensure Caddy reverse proxy is configured correctly
   - Use HTTPS endpoints through Caddy, not direct HTTP

2. **Keplr Not Detected:**
   - Ensure Keplr extension is installed and enabled
   - Wait for extension to initialize (use `waitForKeplr()`)

3. **Transaction Failures:**
   - Check gas limits
   - Verify account has sufficient balance
   - Ensure message types are registered in registry

4. **Merkle Root Mismatch:**
   - **Critical:** Calculate merkle root from encrypted file, not original
   - Ensure storage provider uses same SHA-256 algorithm

5. **Provider Upload Failures:**
   - Verify all required FormData fields are present
   - Check provider address format
   - Ensure Caddy routes `/api/storage/files/upload` correctly

---

## Additional Resources

- [Keplr Wallet Documentation](https://docs.keplr.app/)
- [CosmJS Documentation](https://cosmos.github.io/cosmjs/)
- [Vite Documentation](https://vitejs.dev/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

---

## License

This documentation is provided as-is for reference purposes.

