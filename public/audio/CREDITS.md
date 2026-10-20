# Origine des sons

Une ligne par fichier de ce dossier. Les licences CC BY et CC BY-SA
**exigent** cette attribution ; elle vaut aussi pour les fichiers dérivés
publiés avec le jeu.

## Wikimedia Commons

Prises réelles, récupérées et retaillées par `tools/fetch-cc-sfx.mjs` en
v3.9.0 (112e956) : extrait de 12 s bouclé par fondu enchaîné pour les nappes
(la prise de `nuit`, longue de 0,85 s, est d'abord répétée), détourage, coupe
à 6 s et fondu de sortie pour la cloche, sonie normalisée pour tous.

- **cloche** — « 2011 Christmas bells at Notre-Dame de Paris (excerpt).wav » par Mxsmanic · CC0 (http://creativecommons.org/publicdomain/zero/1.0/deed.en) · https://commons.wikimedia.org/wiki/File%3A2011%20Christmas%20bells%20at%20Notre-Dame%20de%20Paris%20(excerpt).wav · retaillé (détourage et fondu) par tools/fetch-cc-sfx.mjs
- **nuit** — « Jer-Cricket.ogg » par Man vyi · Public domain · https://commons.wikimedia.org/wiki/File%3AJer-Cricket.ogg · retaillé (boucle et fondu) par tools/fetch-cc-sfx.mjs
- **oiseaux** — « Home Dawn Chorus 2020-04-28 0600.mp3 » par Robert EA Harvey · CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0) · https://commons.wikimedia.org/wiki/File%3AHome%20Dawn%20Chorus%202020-04-28%200600.mp3 · retaillé (boucle et fondu) par tools/fetch-cc-sfx.mjs
- **pluie** — « Rain on leaves (Gravity Sound).wav » par Gravity Sound · CC BY 4.0 (https://creativecommons.org/licenses/by/4.0) · https://commons.wikimedia.org/wiki/File%3ARain%20on%20leaves%20(Gravity%20Sound).wav · retaillé (boucle et fondu) par tools/fetch-cc-sfx.mjs

`oiseaux.mp3` est une adaptation d'une œuvre sous CC BY-SA 4.0 : il est
diffusé sous la même licence, CC BY-SA 4.0.

Vérifié le 2026-10-20 : chaque fichier source, téléchargé depuis Commons et
passé par le même traitement ffmpeg que `tools/fetch-cc-sfx.mjs`, redonne un
mp3 identique octet pour octet au fichier de ce dossier.

## ElevenLabs

Sons générés par `tools/gen-sfx.mjs` (text-to-sound-effects), au palier
gratuit, usage non commercial et attribution demandée d'après l'en-tête de
l'outil. Le prompt est celui de l'outil au commit d'ajout du fichier.
L'origine vient de l'historique git (messages de 2c8586a et a9bb54b) : un son
généré n'a pas d'empreinte à comparer.

- **mer** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « Calm gentle ocean waves lapping on a small pebble beach, close and intimate, steady rhythm, no wind, no seagulls, no music, clean field recording » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **feu** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « Small cozy campfire burning steadily, soft continuous crackle, close microphone, no big pops, no wind, no music, clean field recording » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **bourdon** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « Low steady electrical hum of a street lamp ballast, continuous drone, clear and present, no buzzing insects, no music » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **toc** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One single dull knock on a thick wooden log, dry, close, short decay, no reverb, no music » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **carillon** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One short bright glassy chime, single soft note, gentle sparkle, warm decay, no melody, no music bed » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **piece** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « Two small bronze coins clinking together once, dry and close, short, no reverb, no music » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **plouf** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One small stone plopping into calm water, close, short, gentle, no splash of a big object, no music » · tools/gen-sfx.mjs, v3.10.0 (2c8586a)
- **bois** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One single axe chop into a tree trunk, dry wooden crack, close, short, outdoors, no echo, no music » · tools/gen-sfx.mjs, v3.12.0 (a9bb54b)
- **pierre** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One single stone pick striking rock, sharp mineral crack with small debris, close, short, no echo, no music » · tools/gen-sfx.mjs, v3.12.0 (a9bb54b)
- **cueillette** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One short rustle of hands pulling leaves and berries from a bush, dry foliage, close, brief, no music » · tools/gen-sfx.mjs, v3.12.0 (a9bb54b)
- **chasse** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · prompt : « One spear thrust into hide and straw, dull thud with a short fibrous tear, close, brief, no music, no animal cry » · tools/gen-sfx.mjs, v3.12.0 (a9bb54b)
