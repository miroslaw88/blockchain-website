import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      // Enable polyfills for Node.js built-ins
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
            main: './index.html'
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

