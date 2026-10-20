// Les outils de sons (fetch-cc-sfx, fetch-sfx, gen-sfx) ne traitent qu'une
// partie des fichiers à chaque passe. Ils réécrivaient CREDITS.md avec la
// seule passe en cours : 14 attributions sur 15 avaient disparu. La fusion
// remplace la ligne de chaque son traité et garde tout le reste.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { mergeCredits, creditId, DEFAULT_HEADER } = await import('../tools/credits-file.mjs')

const EXISTING = `# Origine des sons

Texte d'en-tête écrit à la main.

## Commons

- **cloche** — ancienne cloche
- **nuit** — grillons

Note sous la liste.

## ElevenLabs

- **mer** — ressac
`

test('une passe --only=nuit garde les autres lignes et le texte libre', () => {
  const out = mergeCredits(EXISTING, { nuit: '- **nuit** — nouvelle prise' })
  assert.equal(out, EXISTING.replace('- **nuit** — grillons', '- **nuit** — nouvelle prise'))
})

test('un son nouveau est ajouté après le dernier crédit, sans rien effacer', () => {
  const out = mergeCredits(EXISTING, { plouf: '- **plouf** — caillou', cloche: '- **cloche** — neuve' })
  const ids = out.split('\n').map(creditId).filter(Boolean)
  assert.deepEqual(ids, ['cloche', 'nuit', 'mer', 'plouf'])
  assert.match(out, /- \*\*cloche\*\* — neuve/)
  assert.match(out, /Texte d'en-tête écrit à la main\./)
  assert.match(out, /Note sous la liste\./)
  assert.doesNotMatch(out, /ancienne cloche/)
})

test('sans CREDITS.md, la fusion part de l’en-tête par défaut', () => {
  const out = mergeCredits(null, { toc: '- **toc** — bûche' })
  assert.equal(out, `${DEFAULT_HEADER}\n- **toc** — bûche\n`)
})

test('deux passes successives cumulent les crédits', () => {
  const a = mergeCredits(null, { cloche: '- **cloche** — a' })
  const b = mergeCredits(a, { pluie: '- **pluie** — b' })
  assert.deepEqual(b.split('\n').map(creditId).filter(Boolean), ['cloche', 'pluie'])
})

test('une ligne dont l’identifiant ne correspond pas est refusée', () => {
  assert.throws(() => mergeCredits(null, { toc: '- **plouf** — faux' }), /mal formée/)
})
