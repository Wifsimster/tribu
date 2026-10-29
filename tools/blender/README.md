# Les scripts Blender du colon

Tout ce qui sort de Blender pour le colon est produit par ces scripts : rien
n'est fait à la main dans l'interface. Ils reconstruisent la scène « Colon »
(armature, proxy, outils, clips) et exportent les deux glb du jeu,
`src/assets/models/settler-clips.glb` et `settler-tools.glb`.

| Script | Rôle |
| --- | --- |
| `tribu_io.py` | Repères (jeu y en haut ↔ Blender z en haut), couleurs, écriture du glb compact |
| `settler_rig.py` | Armature « Colon » : os aux pivots de `src/render/settler-rig.json`, proxy du jeu attaché à chaque os |
| `settler_tools.py` | Faucille, faux, panier et son contenu (3 crans), gerbe (3 crans) |
| `settler_clips.py` | Les gestes `gather_hand`, `gather_sickle`, `gather_scythe` : clés et marqueurs (`strike`, `fill`, `loop_in`, `loop_out`) |
| `export_settler.py` | Échantillonnage à 30 i/s, décimation, positions de contrôle (`extras.check`), écriture des glb |
| `build_settler.py` | Enchaîne le tout |
| `mcp_bridge.py` | Lance `build_settler` dans le Blender ouvert du poste « PC fixe » (MCP) et renvoie les glb au serveur |

## Rejouer

1. Le proxy du colon, sorti du jeu :

   ```sh
   node --import ./tests/resolve-ts.mjs tools/export-settler-proxy.mjs /tmp/settler-proxy.json
   ```

2. Blender 5.2, en ligne de commande :

   ```sh
   blender --background --factory-startup --python tools/blender/build_settler.py -- . /tmp/settler-proxy.json /tmp/colon-out
   cp /tmp/colon-out/settler-*.glb src/assets/models/
   ```

   `report.json` donne la taille et le sha256 de chaque glb, les triangles de
   chaque outil, et, pour chaque clip, la hauteur du bout d'outil aux
   événements et le pied le plus bas.

3. Ou depuis le Blender ouvert du PC fixe (piloté par MCP, sans accès aux
   fichiers du serveur) : servir les fichiers du dépôt et un dossier d'arrivée
   par HTTP sur le réseau privé, puis exécuter dans Blender
   `BASE = 'http://<serveur>:<port>/<jeton>/'` suivi du contenu de
   `mcp_bridge.py`. Les glb reviennent par PUT, et le sha256 est comparé des
   deux côtés.

4. `corepack pnpm test` : `tests/settler-clip-parity.test.mjs` compare, au
   millième, les positions calculées par Blender à celles du jeu.

La scène « Colon » est créée à côté des scènes ouvertes ; le fichier .blend
n'est jamais enregistré par ces scripts.

## Compresser les glb du jeu

Après tout export vers `src/assets/models/`, lancer `corepack pnpm models:pack`
(`tools/pack-models.mjs`, gltfpack/meshoptimizer, MIT) : les glb des reliques,
véhicules et wagons passent en `EXT_meshopt_compression`, sans simplification.
Le script ignore ce qui est déjà compressé, les glb lus à la main (faune,
colon : `fauna-glb.ts`, `settler-clips.ts`, sans décodeur meshopt) et ceux qui
portent un attribut personnalisé (`_STAGE` des Merveilles, que gltfpack 1.3
supprime). Le chargeur (`src/render/models.ts`) et les tests branchent
`MeshoptDecoder`.
