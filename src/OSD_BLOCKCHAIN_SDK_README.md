# OSD Blockchain SDK

A reusable TypeScript library for encrypting/decrypting files and posting blockchain transactions for the OSD Blockchain storage system.

## Features

- **File Encryption/Decryption**: Chunked AES-256-GCM encryption with ECIES key derivation (Jackal-style)
- **Blockchain Transactions**: Post file metadata to blockchain and receive storage provider assignments
- **Key Management**: Automatic ECIES key derivation from wallet signatures with caching
- **Framework Agnostic**: No jQuery or framework dependencies - pure TypeScript/JavaScript

## Installation

### Dependencies

```bash
npm install @cosmjs/stargate @cosmjs/proto-signing
```

### Required Setup

1. **Keplr Wallet**: Users must have the Keplr wallet extension installed
2. **Protobuf Types**: You need to generate TypeScript types from your `.proto` files
   - The SDK expects types at: `./generated/osdblockchain/osdblockchain/v1/tx` and `./generated/osdblockchain/osdblockchain/v1/storage_provider`
   - Generate using `protoc` or `@cosmjs/proto-signing`

## Usage

### Basic Example

```typescript
import { 
    encryptFile, 
    decryptFile, 
    postFileToBlockchain, 
    calculateMerkleRoot, 
    hashFilename,
    getKeplr 
} from './osd-blockchain-sdk';

// 1. Check if Keplr is available
const keplr = getKeplr();
if (!keplr) {
    throw new Error('Keplr wallet not installed');
}

// 2. Enable chain and get user address
await keplr.enable('osdblockchain');
const offlineSigner = keplr.getOfflineSigner('osdblockchain');
const accounts = await offlineSigner.getAccounts();
const userAddress = accounts[0].address;

// 3. Encrypt a file
const file = document.querySelector('input[type="file"]').files[0];
const encryptedChunks = await encryptFile(file, userAddress);

// 4. Calculate Merkle roots
const chunkMerkleRoots: string[] = [];
for (const chunk of encryptedChunks) {
    const chunkData = await chunk.arrayBuffer();
    const chunkMerkleRoot = await calculateMerkleRoot(chunkData);
    chunkMerkleRoots.push(chunkMerkleRoot);
}

// Calculate combined merkle root
const combinedChunksArray = new Uint8Array(
    encryptedChunks.reduce((total, chunk) => total + chunk.size, 0)
);
let offset = 0;
for (const chunk of encryptedChunks) {
    const chunkData = await chunk.arrayBuffer();
    combinedChunksArray.set(new Uint8Array(chunkData), offset);
    offset += chunkData.byteLength;
}
const combinedMerkleRoot = await calculateMerkleRoot(combinedChunksArray.buffer);

// 5. Hash filename
const hashedFileName = await hashFilename(file.name);

// 6. Post to blockchain
const expirationTime = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days
const metadata = {
    name: hashedFileName,
    original_name: file.name,
    content_type: file.type || 'application/octet-stream'
};

const result = await postFileToBlockchain(
    combinedMerkleRoot,
    encryptedChunks.reduce((sum, chunk) => sum + chunk.size, 0),
    expirationTime,
    3, // maxProofs
    metadata
);

console.log('Transaction hash:', result.transactionHash);
console.log('Storage providers:', result.providers);
```

### Decrypting a File

```typescript
import { decryptFile } from './osd-blockchain-sdk';

// Assuming you have the encrypted blob and user address
const encryptedBlob = await fetch(encryptedFileUrl).then(r => r.blob());
const decryptedBlob = await decryptFile(encryptedBlob, userAddress);

// Save or use the decrypted file
const url = URL.createObjectURL(decryptedBlob);
const a = document.createElement('a');
a.href = url;
a.download = 'decrypted-file';
a.click();
URL.revokeObjectURL(url);
```

## API Reference

### Encryption/Decryption

#### `encryptFile(file: File | Blob, userAddress: string, chainId?: string): Promise<Blob[]>`

Encrypts a file using chunked AES-256-GCM with ECIES key derivation.

- **Parameters:**
  - `file`: The file or blob to encrypt
  - `userAddress`: User's Cosmos wallet address (bech32 format)
  - `chainId`: Optional chain ID (defaults to 'osdblockchain')
- **Returns:** Array of encrypted chunks, each formatted with size header, IV, and encrypted data

#### `decryptFile(encryptedBlob: Blob, userAddress: string, chainId?: string): Promise<Blob>`

Decrypts an encrypted file blob.

- **Parameters:**
  - `encryptedBlob`: The encrypted file blob (with size headers)
  - `userAddress`: User's Cosmos wallet address (bech32 format)
  - `chainId`: Optional chain ID (defaults to 'osdblockchain')
- **Returns:** Decrypted file blob

### Cryptographic Utilities

#### `calculateMerkleRoot(data: ArrayBuffer): Promise<string>`

Calculates SHA256 hash (Merkle root) of data.

#### `hashFilename(filename: string): Promise<string>`

Hashes a filename using SHA256 (filename + timestamp).

### Key Management

#### `deriveECIESPrivateKey(userAddress: string, chainId?: string): Promise<CryptoKey>`

Derives ECIES private key material from wallet signature. Results are cached per address.

#### `clearECIESKeyCache(): void`

Clears the ECIES key material cache (useful for logout).

### Blockchain Transactions

#### `postFileToBlockchain(...): Promise<PostFileResult>`

Posts file metadata to blockchain and receives storage provider assignments.

**Parameters:**
- `merkleRoot: string` - SHA256 hash of encrypted file
- `sizeBytes: number` - Total size of encrypted file
- `expirationTime: number` - Unix timestamp for expiration
- `maxProofs: number` - Maximum storage proofs required
- `metadata: FileMetadata` - File metadata object
- `rpcEndpoint?: string` - RPC endpoint (defaults to 'https://storage.datavault.space/rpc')
- `chainId?: string` - Chain ID (defaults to 'osdblockchain')

**Returns:**
```typescript
{
    transactionHash: string;
    providers: StorageProvider[];
    primaryProviderIndex: number;
}
```

### Utilities

#### `getKeplr(): KeplrWindow['keplr']`

Gets the Keplr wallet instance from the window object.

## Configuration Constants

- `CHAIN_ID`: Default chain ID ('osdblockchain')
- `ENCRYPTION_CHUNK_SIZE`: 32MB chunks
- `PBKDF2_ITERATIONS`: 10000
- `AES_TAG_LENGTH`: 128 bits

## Encryption Format

Each encrypted chunk is formatted as:
```
[8-byte size header][12-byte IV][encrypted chunk + 16-byte authentication tag]
```

- **Size header**: ASCII string of chunk size (padded to 8 bytes with zeros)
- **IV**: 12-byte initialization vector (random for each chunk)
- **Encrypted data**: AES-256-GCM encrypted chunk data with 16-byte authentication tag

## Key Derivation

1. User signs "Initiate Storage Session" message with Keplr
2. Signature is hashed with SHA-256 to create ECIES private key material
3. ECIES key material is used with PBKDF2 to derive AES-256-GCM key
4. Results are cached per user address to avoid repeated signature requests

## Error Handling

All functions throw errors that should be caught:

```typescript
try {
    const encryptedChunks = await encryptFile(file, userAddress);
} catch (error) {
    if (error instanceof Error) {
        console.error('Encryption failed:', error.message);
    }
}
```

Common errors:
- `Keplr not available`: Keplr extension not installed or not accessible
- `Keplr signArbitrary not available`: Keplr doesn't support arbitrary signing
- `Account not found`: User account not found on blockchain
- `Transaction failed`: Blockchain transaction failed (check `rawLog` for details)
- `Invalid encrypted file format`: Encrypted blob format is invalid

## Browser Compatibility

- Requires Web Crypto API (available in all modern browsers)
- Requires ES2020+ features (async/await, optional chaining, etc.)
- Tested in Chrome, Firefox, Edge (latest versions)

## License

Use this SDK in your projects as needed. Ensure you have proper licenses for dependencies.

