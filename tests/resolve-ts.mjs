// Les sources importent leurs voisins sans extension (résolution « bundler »
// de Vite). Node, lui, exige l'extension : ce crochet la rajoute pour les
// imports relatifs. Node 24 retire les types des .ts tout seul — pas besoin
// de tsx ni d'aucune dépendance pour faire tourner la simulation.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier)) throw err
      return next(`${specifier}.ts`, context)
    }
  },
  // `import x from './a.glb?url'` : chez Vite, l'URL hachée du fichier. Ici,
  // l'URL du fichier lui-même — le village s'importe ainsi sous Node pour le
  // test de son plan, sans que rien ne charge le modèle.
  load(url, context, next) {
    if (url.endsWith('?url')) {
      return {
        format: 'module',
        source: `export default ${JSON.stringify(url.slice(0, -'?url'.length))}`,
        shortCircuit: true,
      }
    }
    return next(url, context)
  },
})
