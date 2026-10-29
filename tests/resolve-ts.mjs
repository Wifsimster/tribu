import { readFileSync } from 'node:fs'
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
  load(url, context, next) {
    if (url.endsWith('?url')) {
      return {
        format: 'module',
        source: `export default ${JSON.stringify(url.slice(0, -'?url'.length))}`,
        shortCircuit: true,
      }
    }
    if (url.startsWith('file:') && url.endsWith('.json')) {
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        shortCircuit: true,
      }
    }
    return next(url, context)
  },
})
