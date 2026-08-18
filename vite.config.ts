import { defineConfig } from 'vite'

// Mobile is the primary target: keep the main bundle small enough to be
// interactive in under three seconds on simulated 4G. three.js is split out so
// it caches independently of game logic, which changes every deploy.
export default defineConfig({
  build: {
    target: 'es2020',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { host: true },
})
