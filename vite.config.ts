import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const port = Number(process.env.PORT) || 5173;
const host = process.env.VITE_DEV_HOST || '127.0.0.1';
const allowedHosts = process.env.VITE_ALLOWED_HOSTS
  ? process.env.VITE_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
  : undefined;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          framer: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          ui: [
            'lucide-react',
            'react-icons',
            'recharts',
            'cmdk',
            'vaul',
            'embla-carousel-react',
          ],
        },
      },
    },
    target: 'es2020',
    cssMinify: 'lightningcss',
  },
  server: {
    port,
    strictPort: false,
    host,
    allowedHosts,
    fs: { strict: true },
  },
  preview: {
    port: 4173,
    host,
    allowedHosts,
  },
});
