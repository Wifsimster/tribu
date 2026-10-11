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
})
