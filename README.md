# Cosmos Keplr Wallet Connector

A simple website to connect your Keplr wallet for Cosmos blockchain interactions with file upload capabilities.

## Features

- Connect to Keplr wallet
- Display wallet address and connection status
- View files from blockchain
- Upload and encrypt files to blockchain
- Modern UI with Bootstrap 5.3.2
- TypeScript support
- Vite bundler for optimal performance

## Prerequisites

- Node.js and npm installed
- Keplr wallet extension installed in your browser

## Setup

1. Install dependencies:
```bash
npm install
```

2. Development mode (with hot reload):
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

4. Preview production build:
```bash
npm run preview
```

## Development

- **Development server**: `npm run dev` - Starts Vite dev server on http://localhost:8080
- **Build**: `npm run build` - Creates optimized production build in `dist/` folder
- **Preview**: `npm run preview` - Preview the production build locally

## Usage

1. Make sure Keplr wallet is installed in your browser
2. Run `npm run dev` to start the development server
3. Open http://localhost:8080 in your browser
4. Click "Connect Wallet" button
5. Approve the connection in Keplr
6. Your wallet address will be displayed and you'll be redirected to the dashboard
7. Use "View Files" to see your files or drag & drop files to upload

## Chain Configuration

Configured for OSD Blockchain (osdblockchain). The chain configuration is in `src/wallet.ts`.

## Technology Stack

- **Vite** - Fast build tool and dev server
- **TypeScript** - Type-safe JavaScript
- **Bootstrap 5.3.2** - UI framework
- **@cosmjs/stargate** - Cosmos SDK client
- **Keplr Wallet** - Browser extension for Cosmos chains

## File Upload

The file upload feature:
1. Encrypts files using wallet signature
2. Calculates Merkle root (SHA-256 hash)
3. Posts transaction to blockchain
4. Uploads encrypted file to storage provider

## Notes

- The build uses Vite which bundles all dependencies including CosmJS libraries
- Large bundle size is expected due to CosmJS dependencies (~2.7MB)
- For production, consider code-splitting or lazy loading
