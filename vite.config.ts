import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: '/melanite/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Melanite',
        short_name: 'Melanite',
        description: 'Local-first Markdown notes with plugins',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#141114',
        theme_color: '#141114',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // mermaid y katex se cargan bajo demanda pero tienen que estar offline
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  // mermaid trae chunks grandes, pero se cargan solo si una nota tiene un diagrama
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
