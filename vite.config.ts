import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel deployment — no base path needed (was /biometric-attendance-system/ for GitHub Pages)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // base defaults to '/' — correct for Vercel
});
