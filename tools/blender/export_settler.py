# Export des clips et des outils du colon vers le jeu.
#
# settler-clips.glb : les nœuds body head armL armR legL legR toolR toolL prop
#   cast, sans maillage, dans la hiérarchie DU JEU (membres à plat sous le
#   rig, outils dans la main, accessoire dans le torse), translation = pivot
#   de settler-rig.json. Une animation glTF par clip : translation et
#   rotation de chaque nœud, échantillonnées à 30 i/s sur ce que Blender
#   évalue, puis décimées (LINEAR, 0,002 rad / 0,0005 u d'erreur au plus).
#   Restent toujours en clé : les marqueurs et les 12 instants de contrôle.
#   extras : tool, carry, loops, events [{name, t}], et `check` — les
#   positions de la main droite, du bout d'outil et des deux pieds, calculées
#   par Blender sur ses propres os, en espace du colon (rig × échelle) : la
#   référence du test de parité du jeu (tests/settler-clip-parity.test.mjs).
#
# settler-tools.glb : un nœud par outil ou accessoire, origine = point de
#   prise, POSITION/NORMAL/COLOR_0 float32, indices uint16 ; extras : node
#   (toolR, toolL), tip (bout de l'outil), edge (couleur du tranchant).

import json
import math

import bpy
from mathutils import Vector

from tribu_io import C_B2G, C_G2B, FLOAT, FPS, USHORT, Glb, b2g, euler, g2b, r6

NODES = ('body', 'head', 'armL', 'armR', 'legL', 'legR', 'toolR', 'toolL', 'prop', 'cast')
ROT_TOL = 0.002
POS_TOL = 0.0005
CHECKS = 12


def game_matrices(arm_eval):
    """Matrice monde (espace du rig, repère du jeu) de chaque os évalué."""
    return {n: C_B2G @ arm_eval.pose.bones[n].matrix @ C_G2B for n in NODES}


def angle(a, b):
    return 2 * math.acos(min(1.0, abs(a.dot(b))))


def decimate(times, values, forced, is_rot):
    """Garde le moins de clés possible : une clé tombe si l'interpolation
    (slerp ou linéaire) de ses voisines gardées retrouve tous les échantillons
    entre deux à la tolérance près. Aux instants imposés (marqueurs, instants
    de contrôle), la tolérance est quasi nulle : le jeu y retrouve exactement
    ce que Blender a évalué, sans payer une clé là où le canal ne bouge pas."""
    def err(i, j, m):
        k = (times[m] - times[i]) / (times[j] - times[i])
        if is_rot:
            return angle(values[i].slerp(values[j], k), values[m])
        return (values[i].lerp(values[j], k) - values[m]).length

    def tol(m):
        if m in forced:
            return 2e-5 if is_rot else 1e-5
        return ROT_TOL if is_rot else POS_TOL

    keep = [0]
    i = 0
    n = len(times)
    while i < n - 1:
        j = i + 1
        while j + 1 < n and all(err(i, j + 1, m) <= tol(m) for m in range(i + 1, j + 1)):
            j += 1
        keep.append(j)
        i = j
    return keep


def sample_clip(scene, arm, act, rig, tips):
    info = json.loads(act['tribu'])
    arm.animation_data.action = act
    last = int(act.frame_range[1])
    markers = sorted((m.frame, m.name) for m in act.pose_markers)
    checks = [round(i * last / (CHECKS - 1)) for i in range(CHECKS)]
    forced = {0, last} | {f for f, _ in markers} | set(checks)
    parent = {n: rig['nodes'][n]['parent'] for n in NODES}
    scale = rig['scale']
    tip_local = tips[info['tool']]
    pts = {
        'hand': ('armR', rig['points']['hand']['at']),
        'tip': ('toolR', tip_local),
        'footL': ('legL', rig['points']['footL']['at']),
        'footR': ('legR', rig['points']['footR']['at']),
    }
    trs = {n: ([], []) for n in NODES}
    check = []
    probes = []
    marker_frames = {f for f, _ in markers}
    frames = list(range(0, last + 1))
    for f in frames:
        scene.frame_set(f)
        arm_eval = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        world = game_matrices(arm_eval)
        for n in NODES:
            m = world[n]
            if parent[n]:
                m = world[parent[n]].inverted() @ m
            loc, rot, _ = m.decompose()
            rots = trs[n][1]
            if rots and rots[-1].dot(rot) < 0:
                rot = -rot
            trs[n][0].append(loc)
            rots.append(rot)
        if f in marker_frames:
            tip = b2g(arm_eval.pose.bones['toolR'].matrix @ g2b(tip_local)) * scale
            probes.append([r6(f / FPS)] + [round(v, 3) for v in tip])
        if f in checks:
            # Référence indépendante de l'export : les os de Blender eux-mêmes.
            row = {'t': r6(f / FPS)}
            for key, (bone, local) in pts.items():
                p = arm_eval.pose.bones[bone].matrix @ g2b(local)
                row[key] = [r6(v * scale) for v in b2g(p)]
            check.append(row)
    times = [f / FPS for f in frames]
    tracks = {}
    for n in NODES:
        locs, rots = trs[n]
        tracks[n] = {
            'translation': [(times[i], locs[i]) for i in decimate(times, locs, forced, False)],
            'rotation': [(times[i], rots[i]) for i in decimate(times, rots, forced, True)],
        }
    return {
        'name': act.name, 'duration': last / FPS, 'tool': info['tool'], 'carry': info['carry'],
        'loops': info['loops'], 'events': [{'name': n, 't': r6(f / FPS)} for f, n in markers],
        'check': check, 'probes': probes, 'tracks': tracks, 'samples': trs, 'times': times,
    }


def clips_glb(rig, clips):
    g = Glb(one_view=True)
    nodes = []
    for n in NODES:
        node = {'name': n, 'translation': [r6(v) for v in rig['nodes'][n]['pivot']]}
        rest = rig['nodes'][n].get('rest')
        if rest:
            q = euler(rest)
            node['rotation'] = [r6(q.x), r6(q.y), r6(q.z), r6(q.w)]
        nodes.append(node)
    index = {n: i for i, n in enumerate(NODES)}
    for n in NODES:
        p = rig['nodes'][n]['parent']
        if p:
            nodes[index[p]].setdefault('children', []).append(index[n])
    g.json['nodes'] = nodes
    g.json['scenes'] = [{'nodes': [index[n] for n in NODES if not rig['nodes'][n]['parent']]}]
    g.json['scene'] = 0
    anims = []
    for c in clips:
        samplers, channels = [], []
        for n in NODES:
            for path, keys in c['tracks'][n].items():
                if path == 'translation' and all((p - Vector(rig['nodes'][n]['pivot'])).length < 1e-6 for _, p in keys):
                    continue  # immobile au pivot : le nœud garde sa translation de repos
                inp = g.add([k[0] for k in keys], FLOAT, 'SCALAR', minmax=True)
                if path == 'rotation':
                    flat = [v for _, q in keys for v in (q.x, q.y, q.z, q.w)]
                    out = g.add(flat, FLOAT, 'VEC4')
                else:
                    flat = [v for _, p in keys for v in (p.x, p.y, p.z)]
                    out = g.add(flat, FLOAT, 'VEC3')
                samplers.append({'input': inp, 'output': out, 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': index[n], 'path': path}})
        anims.append({
            'name': c['name'], 'samplers': samplers, 'channels': channels,
            'extras': {'tool': c['tool'], 'carry': c['carry'], 'loops': c['loops'],
                       'events': c['events'], 'check': c['check']},
        })
    g.json['animations'] = anims
    return g.bytes()


def tool_arrays(ob):
    """Sommets (repère du nœud du jeu), normales par coin, couleurs, triangles."""
    me = ob.data
    me.calc_loop_triangles()
    pivot = Vector(ob['tribu_pivot'])
    col = me.color_attributes['Col'].data
    corner_n = me.corner_normals
    seen = {}
    pos, nor, rgb, idx = [], [], [], []
    for tri in me.loop_triangles:
        for li, vi in zip(tri.loops, tri.vertices):
            n = b2g(corner_n[li].vector)
            key = (vi, round(n.x, 5), round(n.y, 5), round(n.z, 5))
            k = seen.get(key)
            if k is None:
                k = seen[key] = len(pos) // 3
                p = b2g(me.vertices[vi].co) - pivot
                pos += [p.x, p.y, p.z]
                nor += [n.x, n.y, n.z]
                c = col[vi].color
                rgb += [c[0], c[1], c[2]]
            idx.append(k)
    return pos, nor, rgb, idx


def tools_glb(objs):
    g = Glb()
    nodes, meshes, report = [], [], {}
    for name in sorted(objs):
        ob = objs[name]
        if ob.get('tribu_view_only'):
            continue
        pos, nor, rgb, idx = tool_arrays(ob)
        assert len(pos) // 3 < 65536
        prim = {'attributes': {'POSITION': g.add(pos, FLOAT, 'VEC3', minmax=True),
                               'NORMAL': g.add(nor, FLOAT, 'VEC3'),
                               'COLOR_0': g.add(rgb, FLOAT, 'VEC3')},
                'indices': g.add(idx, USHORT, 'SCALAR'), 'mode': 4}
        meshes.append({'name': name, 'primitives': [prim]})
        extras = {'node': ob['tribu_node']}
        if 'tribu_tip' in ob:
            extras['tip'] = [r6(v) for v in ob['tribu_tip']]
        if 'tribu_edge' in ob:
            extras['edge'] = [r6(v) for v in ob['tribu_edge']]
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'extras': extras})
        report[name] = len(idx) // 3
    g.json['nodes'] = nodes
    g.json['meshes'] = meshes
    g.json['scenes'] = [{'nodes': list(range(len(nodes)))}]
    g.json['scene'] = 0
    return g.bytes(), report


def summary(c):
    """Ce que les tests du jeu vérifieront, vu depuis Blender : hauteur du bout
    d'outil aux frappes, pieds sous le sol, glissement des pieds."""
    ev = {e['name']: [] for e in c['events']}
    for e in c['events']:
        ev[e['name']].append(e['t'])
    feet_y = min(min(r['footL'][1], r['footR'][1]) for r in c['check'])
    span = max(max(abs(a - b) for a, b in zip(r['tip'], c['check'][0]['tip'])) for r in c['check'])
    return {'events': ev, 'tip_at_events': c['probes'], 'feet_min_y': round(feet_y, 4), 'tip_motion': round(span, 3),
            'keys': sum(len(t['rotation']) + len(t['translation']) for t in c['tracks'].values())}


def export(scene, arm, objs, rig):
    win = bpy.context.window_manager.windows[0]
    prev = win.scene
    win.scene = scene
    try:
        tips = {'hand': rig['points']['fingers']['at']}
        for name, ob in objs.items():
            if 'tribu_tip' in ob:
                tips[name] = list(ob['tribu_tip'])
        acts = [bpy.data.actions[n] for n in ('gather_hand', 'gather_sickle', 'gather_scythe')]
        clips = [sample_clip(scene, arm, a, rig, tips) for a in acts]
        clip_bytes = clips_glb(rig, clips)
        tool_bytes, tris = tools_glb(objs)
        report = {'clips': {c['name']: summary(c) for c in clips}, 'tool_triangles': tris}
        return clip_bytes, tool_bytes, report, clips
    finally:
        win.scene = prev
