// Un traducteur GLSL → JavaScript, limité à ce qu'écrit `RIG_PARS`
// (src/render/fauna-rig.ts) : flottants et vec2/3/4, swizzles en lecture et
// en écriture, `if`/`return`, ternaire, `inout`, tableaux d'uniformes et les
// fonctions intégrées listées dans `BUILTINS`. Il sert au test de parité du
// squelette de la faune, qui doit tourner sous Node, sans GPU ni navigateur.
//
// Tout ce qu'il ne connaît pas est une erreur, jamais un repli : si le shader
// gagne une construction nouvelle (boucle, matrice, `else`…), le test casse
// en le disant, et il faut l'ajouter ici plutôt que de la deviner.
//
// Les calculs se font en double précision, comme la copie TS : ce test
// vérifie que les deux écrivent la même formule. Que le GPU (en simple
// précision) rende bien cette formule, la QA l'a mesuré une fois par
// transform feedback sous SwiftShader le 2026-10-20 (PR #24) : écart max
// 2,0e-4 u, cerf, tête.

const TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'void'])
const SIZE = { float: 1, vec2: 2, vec3: 3, vec4: 4 }
// Priorités : ternaire < || < && < comparaisons < + - < * / < unaire < postfixe.
const LEVELS = [['||'], ['&&'], ['==', '!=', '<', '>', '<=', '>='], ['+', '-'], ['*', '/']]

function tokenize(src) {
  const out = []
  const re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\d+\.\d*|\.\d+|\d+)|([A-Za-z_]\w*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||[-+*/<>=!?:;,.(){}[\]])/y
  let i = 0
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m) throw new Error(`GLSL : caractère inattendu ${JSON.stringify(src.slice(i, i + 20))}`)
    i = re.lastIndex
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] })
    else if (m[3] !== undefined) out.push({ t: 'op', v: m[3] })
  }
  return out
}

// ── Exécution : nombres ou tableaux de 2 à 4 composantes, jamais modifiés ──
const zip = (a, b, f) => {
  if (typeof a === 'number' && typeof b === 'number') return f(a, b)
  const n = typeof a === 'number' ? b.length : a.length
  if (typeof a !== 'number' && typeof b !== 'number' && a.length !== b.length) throw new Error('GLSL : tailles de vecteurs différentes')
  return Array.from({ length: n }, (_, i) => f(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i]))
}
const map = (a, f) => (typeof a === 'number' ? f(a) : a.map(f))
const SW = { x: 0, y: 1, z: 2, w: 3 }
const swIdx = (s) => [...s].map((c) => {
  if (!(c in SW)) throw new Error(`GLSL : swizzle inconnu .${s}`)
  return SW[c]
})
const scalar = (v, what) => {
  if (typeof v !== 'number') throw new Error(`GLSL : ${what} attend un float`)
  return v
}

export const RT = {
  add: (a, b) => zip(a, b, (x, y) => x + y),
  sub: (a, b) => zip(a, b, (x, y) => x - y),
  mul: (a, b) => zip(a, b, (x, y) => x * y),
  div: (a, b) => zip(a, b, (x, y) => x / y),
  neg: (a) => map(a, (x) => -x),
  cmp: (a, b, f) => f(scalar(a, 'une comparaison'), scalar(b, 'une comparaison')),
  get(v, s) {
    if (typeof v === 'number') throw new Error(`GLSL : .${s} sur un float`)
    const ix = swIdx(s)
    for (const i of ix) if (i >= v.length) throw new Error(`GLSL : .${s} hors du vecteur`)
    return ix.length === 1 ? v[ix[0]] : ix.map((i) => v[i])
  },
  set(v, s, val) {
    const ix = swIdx(s)
    const out = [...v]
    ix.forEach((i, k) => {
      if (i >= v.length) throw new Error(`GLSL : .${s} hors du vecteur`)
      out[i] = ix.length === 1 ? scalar(val, `.${s}`) : val[k]
    })
    if (ix.length > 1 && (typeof val === 'number' || val.length !== ix.length)) throw new Error(`GLSL : .${s} reçoit une autre taille`)
    return out
  },
  vec(n, args) {
    const flat = args.flatMap((a) => (typeof a === 'number' ? [a] : a))
    if (flat.length === 1) return Array(n).fill(flat[0])
    if (flat.length !== n) throw new Error(`GLSL : vec${n} construit avec ${flat.length} composantes`)
    return flat
  },
  truth: (c) => {
    if (typeof c !== 'boolean') throw new Error('GLSL : condition non booléenne')
    return c
  },
}

const fract = (x) => x - Math.floor(x)
const BUILTINS = {
  sin: (a) => map(a, Math.sin),
  cos: (a) => map(a, Math.cos),
  tan: (a) => map(a, Math.tan),
  atan: (...a) => {
    if (a.length !== 1) throw new Error('GLSL : atan à deux arguments non traduit')
    return map(a[0], Math.atan)
  },
  abs: (a) => map(a, Math.abs),
  floor: (a) => map(a, Math.floor),
  fract: (a) => map(a, fract),
  mod: (a, b) => zip(a, b, (x, y) => x - y * Math.floor(x / y)),
  mix: (a, b, t) => RT.add(RT.mul(a, RT.sub(1, t)), RT.mul(b, t)),
  clamp: (x, lo, hi) => zip(zip(x, lo, Math.max), hi, Math.min),
  smoothstep: (e0, e1, x) =>
    map(x, (v) => {
      const t = Math.min(1, Math.max(0, (v - scalar(e0, 'smoothstep')) / (scalar(e1, 'smoothstep') - e0)))
      return t * t * (3 - 2 * t)
    }),
}

// ── Analyse et génération ──────────────────────────────────────────────────
class Parser {
  constructor(tokens) {
    this.k = tokens
    this.i = 0
  }
  peek(o = 0) {
    return this.k[this.i + o]
  }
  is(v) {
    return this.peek()?.v === v
  }
  eat(v) {
    const t = this.k[this.i++]
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`GLSL : « ${v} » attendu, « ${t?.v ?? 'fin'} » trouvé`)
    return t
  }
  ident() {
    const t = this.eat()
    if (t.t !== 'id') throw new Error(`GLSL : identifiant attendu, « ${t.v} » trouvé`)
    return t.v
  }
}

/** Traduit `src` (déclarations globales et fonctions) en un module JS.
 *  Rend `{ call(name, args, globals) }` : `globals` donne attributs,
 *  uniformes et `#define` ; un argument `inout` se passe en `{ v }`. */
export function compileGlsl(src) {
  const p = new Parser(tokenize(src))
  const globals = new Set()
  const fns = new Map()
  const parts = []
  while (p.peek()) {
    const q = p.peek().v
    if (q === 'attribute' || q === 'uniform') {
      p.eat()
      const type = p.ident()
      if (!TYPES.has(type)) throw new Error(`GLSL : type ${type} non traduit`)
      globals.add(p.ident())
      if (p.is('[')) {
        p.eat('[')
        p.eat()
        p.eat(']')
      }
      p.eat(';')
      continue
    }
    const ret = p.ident()
    if (!TYPES.has(ret)) throw new Error(`GLSL : type de retour ${ret} non traduit`)
    const name = p.ident()
    p.eat('(')
    const params = []
    while (!p.is(')')) {
      const inout = p.is('inout') ? (p.eat(), true) : false
      if (p.is('in') || p.is('out')) throw new Error('GLSL : qualificatif in/out non traduit')
      const type = p.ident()
      if (!TYPES.has(type)) throw new Error(`GLSL : type ${type} non traduit`)
      params.push({ name: p.ident(), inout })
      if (p.is(',')) p.eat(',')
    }
    p.eat(')')
    fns.set(name, params)
    const scope = new Set(params.map((x) => x.name))
    const outs = params.filter((x) => x.inout).map((x) => x.name)
    const body = block(p, scope, outs)
    parts.push(`F[${JSON.stringify(name)}] = function (${params.map((x) => x.name).join(', ')}) {\n${body}\n${outs.length ? `return [undefined, ${outs.join(', ')}]` : ''}\n}`)
  }

  function block(p, scope, outs) {
    p.eat('{')
    const lines = []
    const inner = new Set(scope)
    while (!p.is('}')) lines.push(statement(p, inner, outs))
    p.eat('}')
    return lines.join('\n')
  }

  function statement(p, scope, outs) {
    if (p.is('{')) return `{\n${block(p, scope, outs)}\n}`
    if (p.is('if')) {
      p.eat('if')
      p.eat('(')
      const c = expr(p, scope)
      p.eat(')')
      const then = statement(p, new Set(scope), outs)
      if (p.is('else')) throw new Error('GLSL : else non traduit')
      return `if (RT.truth(${c})) ${then}`
    }
    if (p.is('return')) {
      p.eat('return')
      const v = p.is(';') ? 'undefined' : expr(p, scope)
      p.eat(';')
      return outs.length ? `return [${v}, ${outs.join(', ')}];` : `return ${v};`
    }
    for (const kw of ['for', 'while', 'do', 'switch', 'discard', 'break', 'continue', 'const'])
      if (p.is(kw)) throw new Error(`GLSL : ${kw} non traduit`)
    if (p.peek().t === 'id' && TYPES.has(p.peek().v) && p.peek(1)?.t === 'id') {
      const type = p.ident()
      const name = p.ident()
      if (!p.is('=')) throw new Error(`GLSL : ${type} ${name} sans valeur initiale`)
      p.eat('=')
      const v = expr(p, scope)
      p.eat(';')
      scope.add(name)
      return `let ${name} = ${v};`
    }
    const name = p.ident()
    if (!scope.has(name)) throw new Error(`GLSL : affectation à ${name}, inconnu ou global`)
    let sw = null
    if (p.is('.')) {
      p.eat('.')
      sw = p.ident()
    }
    const op = p.eat().v
    const OPS = { '=': null, '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div' }
    if (!(op in OPS)) throw new Error(`GLSL : opérateur d'affectation ${op} non traduit`)
    let v = expr(p, scope)
    p.eat(';')
    const cur = sw ? `RT.get(${name}, '${sw}')` : name
    if (OPS[op]) v = `RT.${OPS[op]}(${cur}, ${v})`
    return sw ? `${name} = RT.set(${name}, '${sw}', ${v});` : `${name} = ${v};`
  }

  function expr(p, scope) {
    const c = binary(p, scope, 0)
    if (!p.is('?')) return c
    p.eat('?')
    const a = expr(p, scope)
    p.eat(':')
    const b = expr(p, scope)
    return `(RT.truth(${c}) ? ${a} : ${b})`
  }
  function binary(p, scope, lvl) {
    if (lvl === LEVELS.length) return unary(p, scope)
    let a = binary(p, scope, lvl + 1)
    while (p.peek() && LEVELS[lvl].includes(p.peek().v) && p.peek().t === 'op') {
      const op = p.eat().v
      const b = binary(p, scope, lvl + 1)
      if (op === '+') a = `RT.add(${a}, ${b})`
      else if (op === '-') a = `RT.sub(${a}, ${b})`
      else if (op === '*') a = `RT.mul(${a}, ${b})`
      else if (op === '/') a = `RT.div(${a}, ${b})`
      else if (op === '&&' || op === '||') a = `(RT.truth(${a}) ${op} RT.truth(${b}))`
      else a = `RT.cmp(${a}, ${b}, (x, y) => x ${op === '==' ? '===' : op === '!=' ? '!==' : op} y)`
    }
    return a
  }
  function unary(p, scope) {
    if (p.is('-')) {
      p.eat('-')
      return `RT.neg(${unary(p, scope)})`
    }
    if (p.is('!')) {
      p.eat('!')
      return `!RT.truth(${unary(p, scope)})`
    }
    return postfix(p, scope)
  }
  function postfix(p, scope) {
    let a = primary(p, scope)
    for (;;) {
      if (p.is('.')) {
        p.eat('.')
        a = `RT.get(${a}, '${p.ident()}')`
      } else if (p.is('[')) {
        // Un indice de tableau est un entier littéral : uRig[5].
        p.eat('[')
        const t = p.eat()
        if (t.t !== 'num' || t.v.includes('.')) throw new Error(`GLSL : indice ${t.v} non traduit`)
        a = `G.idx(${a}, ${t.v})`
        p.eat(']')
      } else return a
    }
  }
  function primary(p, scope) {
    const t = p.peek()
    if (t.t === 'num') {
      p.eat()
      if (!t.v.includes('.')) throw new Error(`GLSL : entier ${t.v} (un float s'écrit ${t.v}.0)`)
      return String(Number(t.v))
    }
    if (p.is('(')) {
      p.eat('(')
      const e = expr(p, scope)
      p.eat(')')
      return `(${e})`
    }
    const name = p.ident()
    if (p.is('(')) {
      p.eat('(')
      const args = []
      const raw = []
      while (!p.is(')')) {
        const at = p.i
        args.push(expr(p, scope))
        raw.push(p.k.slice(at, p.i))
        if (p.is(',')) p.eat(',')
      }
      p.eat(')')
      if (name in SIZE && name !== 'float') return `RT.vec(${SIZE[name]}, [${args.join(', ')}])`
      if (name in BUILTINS) return `B.${name}(${args.join(', ')})`
      const params = fns.get(name)
      if (!params) throw new Error(`GLSL : fonction ${name} inconnue`)
      if (params.some((x) => x.inout)) throw new Error(`GLSL : appel interne à ${name} (inout) non traduit`)
      return `F.${name}(${args.join(', ')})`
    }
    if (scope.has(name)) return name
    if (globals.has(name)) return `G.v(${JSON.stringify(name)})`
    return `G.def(${JSON.stringify(name)})`
  }

  // Un seul module par shader ; `G` lit l'environnement de l'appel en cours.
  let env = null
  const G = {
    v: (k) => {
      if (!(k in env)) throw new Error(`GLSL : ${k} sans valeur`)
      return env[k]
    },
    def: (k) => {
      if (!(k in (env.defines ?? {}))) throw new Error(`GLSL : ${k} inconnu`)
      return env.defines[k]
    },
    idx: (a, i) => {
      if (!Array.isArray(a) || !Number.isInteger(i) || !(i in a)) throw new Error(`GLSL : indice ${i} hors du tableau`)
      return a[i]
    },
  }
  const F = new Function('RT', 'B', 'G', `const F = {}\n${parts.join('\n')}\nreturn F`)(RT, BUILTINS, G)
  return {
    source: parts.join('\n'),
    /** Appelle `name` ; `vars` donne attributs, uniformes et `defines`. */
    call(name, args, vars) {
      env = vars
      const params = fns.get(name)
      const r = F[name](...args.map((a, k) => (params[k].inout ? a.v : a)))
      if (!params.some((x) => x.inout)) return r
      let o = 1
      params.forEach((x, k) => {
        if (x.inout) args[k].v = r[o++]
      })
      return r[0]
    },
  }
}
