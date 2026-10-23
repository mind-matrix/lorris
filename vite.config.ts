import { loadEnv } from 'vite';
import pkg from './package.json';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';


export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Tells deploys apart even when package.json isn't bumped: the commit in CI, "dev" locally.
    __BUILD_ID__: JSON.stringify((loadEnv(mode, '.', 'GITHUB_SHA').GITHUB_SHA ?? '').slice(0, 7) || 'dev'),
  },
  // Served from a sub-path on GitHub Pages (e.g. /lorris/); the deploy workflow sets BASE_PATH.
  base: loadEnv(mode, '.', 'BASE_PATH').BASE_PATH || '/',
  plugins: [
    svelte(),
    VitePWA({
      // A new version waits until the player chooses to update (see src/pwa), so nothing
      // reloads under them mid-game. All assets except index.html have content-hashed names.
      registerType: 'prompt',
      manifest: {
        name: 'Lorris',
        short_name: 'Lorris',
        description: 'A team trick-taking card game for 4 or 6 players',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1b6e48',
        background_color: '#1b6e48',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything so the game works fully offline after the first load.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    minify: 'esbuild',
    cssMinify: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['scripts/vitest.setup.mjs'],
    testTimeout: 120_000,
  },
}));
