import { defineConfig } from 'vite'
import { version } from './package.json'

// Mobile is the primary target: keep the main bundle small enough to be
// interactive in under three seconds on simulated 4G. three.js is split out so
// it caches independently of game logic, which changes every deploy.
export default defineConfig({
  // La version vient de package.json : une seule source de vérité, injectée au
  // build (pas de fetch, pas de fichier séparé à tenir à jour).
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2020',
    cssMinify: true,
    rollupOptions: {
      output: {
        // Les passes de post-traitement ne servent qu'au mode photo : laissées
        // hors du chunk three, elles suivent son import dynamique et le premier
        // chargement n'en paie rien.
        manualChunks: (id) =>
          id.includes('node_modules/three') && !/examples\/jsm\/(postprocessing|shaders)\//.test(id)
            ? 'three'
            : undefined,
      },
    },
  },
  server: { host: true },
})
