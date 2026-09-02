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
    cssCodeSplit: true,
    modulePreload: {
      resolveDependencies: () => [],
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Stable vendor chunks — cached across deploys
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/framer-motion')) return 'framer';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/@tanstack')) return 'query';
          if (
            id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/react-icons') ||
            id.includes('node_modules/recharts') ||
            id.includes('node_modules/cmdk') ||
            id.includes('node_modules/vaul') ||
            id.includes('node_modules/embla-carousel')
          ) return 'ui';
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
