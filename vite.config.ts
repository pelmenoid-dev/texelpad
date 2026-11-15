import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5179,
    strictPort: true,
    watch: {
      ignored: ['**/.cache/**', '**/.impeccable/**', '**/projects/**']
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    },
    chunkSizeWarningLimit: 700
  }
});
