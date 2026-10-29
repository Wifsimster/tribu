import { defineConfig } from 'vite'
import { version } from './package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2020',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('node_modules/three') &&
          !/examples\/jsm\/(postprocessing|shaders|loaders)\//.test(id)
            ? 'three'
            : undefined,
      },
    },
  },
  server: { host: true },
})
