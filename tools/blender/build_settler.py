# Rejoue toute la chaîne Blender du colon : armature + proxy, outils, clips,
# export des deux glb. Rien n'est fait à la main dans Blender : ce script
# reconstruit tout, dans une scène « Colon » à part (la scène ouverte n'est pas
# touchée, le fichier n'est pas enregistré).
#
# Entrées : src/render/settler-rig.json et le proxy du colon, produit par
#   node --import ./tests/resolve-ts.mjs tools/export-settler-proxy.mjs proxy.json
# Sorties : settler-clips.glb, settler-tools.glb et report.json dans <sortie>.
#
# En ligne de commande (Blender 5.2) :
#   blender --background --factory-startup --python tools/blender/build_settler.py -- <dépôt> <proxy.json> <sortie>
# Depuis un Blender déjà ouvert (MCP, poste « PC fixe ») : voir mcp_bridge.py.

import hashlib
import importlib
import json
import os
import sys


def run(repo, proxy_path, out_dir):
    here = os.path.join(repo, 'tools', 'blender')
    if here not in sys.path:
        sys.path.insert(0, here)
    # Rechargés à chaque passe : un Blender ouvert garde ses modules en cache.
    import tribu_io, settler_rig, settler_tools, settler_clips, export_settler
    for mod in (tribu_io, settler_rig, settler_tools, settler_clips, export_settler):
        importlib.reload(mod)

    rig = tribu_io.load_json(os.path.join(repo, 'src', 'render', 'settler-rig.json'))
    proxy = tribu_io.load_json(proxy_path)
    scene, arm, coll = settler_rig.build(rig, proxy)
    objs, extra = settler_tools.build(arm, coll, rig)
    settler_clips.build(arm, rig, extra)
    clip_bytes, tool_bytes, report, _ = export_settler.export(scene, arm, objs, rig)
    settler_clips.show(arm, objs, 'gather_hand')

    os.makedirs(out_dir, exist_ok=True)
    files = {'settler-clips.glb': clip_bytes, 'settler-tools.glb': tool_bytes}
    for name, data in files.items():
        with open(os.path.join(out_dir, name), 'wb') as f:
            f.write(data)
        report.setdefault('files', {})[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    with open(os.path.join(out_dir, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1, sort_keys=True)
    return report


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 3:
        sys.exit('usage : blender -b --python build_settler.py -- <dépôt> <proxy.json> <sortie>')
    print(json.dumps(run(*args), indent=1, sort_keys=True))
