# Les gestes de la cueillette, keyframés dans Blender sur l'armature « Colon »
# (une Action par clip) : gather_hand (main nue et panier), gather_sickle
# (faucille et gerbe), gather_scythe (faux, gerbe sur le dos).
#
# Une clé = une pose. Les membres se posent soit par une rotation locale
# (euler du jeu, parent de travail de settler_rig.AUTHOR_PARENT), soit par une
# VISÉE : le bras pointe vers un point du monde (le buisson, le panier, le
# mancheron de la faux), l'outil s'oriente selon deux directions. C'est un IK
# résolu à chaque clé ; Blender interpole ensuite (Bézier) et l'export
# échantillonne ce qu'il évalue.
#
# Un clip = intro (depuis la pose de repos) + boucle [loop_in, loop_out]
# rejouée `loops` fois + sortie (retour au repos). Les marqueurs de l'Action
# portent les événements : strike (le geste touche), fill (le panier ou la
# gerbe monte d'un cran), loop_in, loop_out.
#
# Les jambes ne bougent pas pendant un clip (aucun pas prévu) : le pied ne
# glisse pas. Elles prennent leur appui dès la première image ; le fondu du
# jeu (0,15 s au moins) les y amène depuis la marche.

import json
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from settler_rig import AUTHOR_PARENT
from settler_tools import SCYTHE_AXIS
from tribu_io import FPS, euler, qg2b, rig_world_pivot

ORDER = ('body', 'legL', 'legR', 'cast', 'head', 'armR', 'toolR', 'armL', 'toolL', 'prop')
DOWN = Vector((0, -1, 0))


def offsets(rig):
    """Décalage de repos de chaque os dans son parent de travail."""
    out = {}
    for name, parent in AUTHOR_PARENT.items():
        p = rig_world_pivot(rig, name)
        out[name] = p - rig_world_pivot(rig, parent) if parent else p
    return out


def look(axis1, dir1, axis2, dir2):
    """Rotation qui envoie axis1 sur dir1 et, autant que possible, axis2 sur dir2."""
    def frame(a, b):
        a = Vector(a).normalized()
        b = Vector(b)
        b = (b - a * b.dot(a)).normalized()
        return Matrix((a, b, a.cross(b))).transposed()
    return (frame(dir1, dir2) @ frame(axis1, axis2).transposed()).to_quaternion()


class Pose:
    """Résout une pose : rotations locales de chaque os (repère du jeu).
    Une visée peut dépendre d'un autre os (`lambda P: …`, P = la pose) : elle
    se résout en deux passes, la seconde sur la pose de la première."""

    def __init__(self, rig, spec, rest):
        self.off = offsets(rig)
        self.solve(spec, rest, None)
        if any(callable(v) for v in spec.values()):
            first = Pose.__new__(Pose)
            first.world = dict(self.world)
            self.solve(spec, rest, first)

    def solve(self, spec, rest, ctx):
        self.world = {}
        self.local = {}
        for name in ORDER:
            parent = AUTHOR_PARENT[name]
            pr, pt = self.world[parent] if parent else (Quaternion(), Vector())
            t = pt + pr @ self.off[name]
            s = spec.get(name, rest.get(name, (0, 0, 0)))
            if callable(s):
                s = s(ctx) if ctx else rest.get(name, (0, 0, 0))
            if isinstance(s, tuple) and s and s[0] == 'aim':
                d = (Vector(s[1]) - t).normalized()
                wq = DOWN.rotation_difference(d)
                if len(s) > 2:
                    wq = Quaternion(d, s[2]) @ wq
                lq = pr.inverted() @ wq
            elif isinstance(s, tuple) and s and s[0] == 'look':
                lq = pr.inverted() @ look(*s[1:])
            elif isinstance(s, tuple) and s and s[0] == 'upright':
                lq = pr.inverted() @ euler(s[1])
            else:
                lq = euler(s)
            self.local[name] = lq
            self.world[name] = (pr @ lq, t)

    def point(self, name, local):
        r, t = self.world[name]
        return t + r @ Vector(local)


def rot_y(v, a):
    v = Vector(v)
    return Vector((v.x * math.cos(a) + v.z * math.sin(a), v.y, -v.x * math.sin(a) + v.z * math.cos(a)))


# ── Les clips ──────────────────────────────────────────────────────────────
# Repère du rig (avant ×1,32) : sol y = 0, le colon regarde +z. Le buisson
# est à ~0,5 devant lui, son demi-hauteur vers y ≈ 0,24.

def gather_hand(rig):
    legs = {'legL': (0.08, 0, -0.04), 'legR': (-0.1, 0, 0.04)}
    # Le panier pend à côté de la hanche gauche, bras écarté : il se voit de
    # dos comme de profil. Il vient devant le ventre recevoir les baies.
    side = (-0.72, 0.46, 0.26)
    front = (-0.18, 0.48, 0.34)
    basket = {'armL': ('aim', side), 'toolL': ('upright', (0, 0, 0))}

    def lean(**kw):
        p = {'body': (1.05, 0, 0), 'head': (-0.62, 0, 0), **legs, **basket}
        p.update(kw)
        return p

    p1, p1in = (0.16, 0.3, 0.5), (0.11, 0.22, 0.54)
    p2, p2in = (0.0, 0.31, 0.52), (-0.03, 0.23, 0.56)

    def rim(P):
        """Les doigts au-dessus du bord du panier, où qu'il soit."""
        return ('aim', P.point('toolL', (0, -0.05, 0)))

    pour = lean(body=(0.95, -0.3, 0), armL=('aim', front), armR=rim)
    keys = [
        (0.0, {**legs}),
        (0.4, lean(armR=('aim', p1))),
        (0.55, lean(armR=('aim', p1in))),
        (0.7, lean(armR=('aim', p1))),
        (0.85, lean(armR=('aim', p2in))),
        (1.0, lean(armR=('aim', (0.02, 0.38, 0.5)))),
        (1.3, pour),
        (1.4, pour),
        (1.8, lean(body=(0.5, 0, 0), head=(-0.22, 0, 0), armR=('aim', (0.5, 0.42, 0.28)))),
        (2.2, lean(armR=('aim', p1))),
        (2.6, {**legs}),
    ]
    return {
        'tool': 'hand', 'carry': {'node': 'toolL', 'kind': 'basket'}, 'loops': 3,
        'keys': keys, 'events': [('strike', 0.55), ('strike', 0.85), ('fill', 1.3), ('loop_in', 0.4), ('loop_out', 2.2)],
    }


def gather_sickle(rig):
    legs = {'legL': (0.1, 0, -0.05), 'legR': (-0.12, 0, 0.05)}
    stalks = (-0.08, 0.36, 0.5)          # la main gauche saisit les tiges

    def pose(body, arm, tool, head=(-0.35, 0, 0)):
        return {'body': body, 'head': head, **legs, 'armR': ('aim', arm), 'toolR': tool,
                'armL': ('aim', stalks), 'toolL': ('upright', (0, 0, 0))}

    # Faucille : le manche (axe -y de l'outil) suit le geste, la lame
    # (ouverte vers +z de l'outil) regarde les tiges.
    raised = pose((0.55, 0.45, 0), (0.85, 1.05, 0.0), ('look', DOWN, (0.4, 0.6, -0.5), (0, 0, 1), (0, 1, 0)))
    mid = pose((0.7, 0.1, 0), (0.55, 0.38, 0.42), ('look', DOWN, (-0.4, -0.1, 1), (0, 0, 1), (-1, 0, 0)))
    cut = pose((0.8, -0.3, 0), (0.12, 0.34, 0.5), ('look', DOWN, (-1, -0.2, 0.35), (0, 0, 1), (0, 0, -1)))
    back = pose((0.62, 0.15, 0), (0.62, 0.62, 0.15), ('look', DOWN, (0.6, -0.3, 0.4), (0, 0, 1), (0, 1, 0)))
    keys = [
        (0.0, {**legs}),
        (0.35, raised),
        (0.48, mid), (0.6, cut), (0.8, cut), (1.4, back), (1.75, raised),
        (1.88, mid), (2.0, cut), (2.2, cut), (2.8, back), (3.15, raised),
        (3.5, {**legs}),
    ]
    return {
        'tool': 'sickle', 'carry': {'node': 'toolL', 'kind': 'sheaf'}, 'loops': 3,
        'keys': keys,
        'events': [('strike', 0.6), ('strike', 2.0), ('fill', 2.2), ('loop_in', 0.35), ('loop_out', 3.15)],
    }


def gather_scythe(rig, nib):
    legs = {'legL': (0.12, 0, -0.12), 'legR': (-0.15, 0, 0.1)}
    hip = Vector((0, 0.44, 0))

    def at(theta, lean=0.35):
        """La faux tournée de theta autour de l'axe du colon (0 = devant)."""
        grip = hip + rot_y((0.18, 0.12, 0.24), theta)
        end = rot_y((0.05, 0.3, 0.95), theta)
        blade = rot_y((-1, 0.1, 0.25), theta)
        return {
            'body': (lean, theta * 0.6, 0), 'head': (-0.15, -theta * 0.4, 0), **legs,
            'armR': ('aim', grip), 'toolR': ('look', SCYTHE_AXIS, end - grip, (-1, 0, 0), blade),
            'armL': lambda P: ('aim', P.point('toolR', nib)),
        }

    wind, front, finish = at(1.25), at(0.0), at(-1.35)
    keys = [
        (0.0, {**legs}),
        (0.5, wind),
        (0.7, front), (0.9, finish), (1.1, finish), (1.8, at(0.0, 0.2)), (2.3, wind),
        (2.8, {**legs}),
    ]
    return {
        'tool': 'scythe', 'carry': {'node': 'prop', 'kind': 'sheaf'}, 'loops': 3,
        'keys': keys, 'events': [('strike', 0.7), ('fill', 1.1), ('loop_in', 0.5), ('loop_out', 2.3)],
    }


def clips(rig, extra):
    return {
        'gather_hand': gather_hand(rig),
        'gather_sickle': gather_sickle(rig),
        'gather_scythe': gather_scythe(rig, extra['scythe_nib']),
    }


def frame_of(t):
    return int(round(t * FPS))


def rest_pose(rig):
    return {n: tuple(node.get('rest', (0, 0, 0))) for n, node in rig['nodes'].items()}


def build(arm, rig, extra):
    """Crée (ou recrée) une Action par clip sur l'armature, clés + marqueurs."""
    rest = rest_pose(rig)
    made = {}
    arm.animation_data_create()
    for name, clip in clips(rig, extra).items():
        old = bpy.data.actions.get(name)
        if old is not None and 'tribu' in old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        prev = {}
        for t, spec in clip['keys']:
            pose = Pose(rig, spec, rest)
            f = frame_of(t)
            for bone in ORDER:
                q = qg2b(pose.local[bone])
                if bone in prev and prev[bone].dot(q) < 0:
                    q = -q
                prev[bone] = q
                pb = arm.pose.bones[bone]
                pb.rotation_quaternion = q
                pb.location = (0, 0, 0)
                pb.keyframe_insert('rotation_quaternion', frame=f, group=bone)
                pb.keyframe_insert('location', frame=f, group=bone)
        for ev, t in clip['events']:
            m = act.pose_markers.new(ev)
            m.frame = frame_of(t)
        act.frame_range = (0, frame_of(clip['keys'][-1][0]))
        act.use_frame_range = True
        act['tribu'] = json.dumps({'tool': clip['tool'], 'carry': clip['carry'], 'loops': clip['loops']})
        made[name] = act
    return made


def show(arm, objs, clip_name, level=3):
    """Montre dans la vue Blender l'outil et l'accessoire d'un clip."""
    info = json.loads(bpy.data.actions[clip_name]['tribu'])
    arm.animation_data.action = bpy.data.actions[clip_name]
    for key, ob in objs.items():
        want = key == info['tool']
        if info['carry']['kind'] == 'basket':
            want |= key == 'basket' or key == 'basket_fill_%d' % level
        elif info['carry']['node'] == 'toolL':
            want |= key == 'sheaf_%d' % level
        else:
            want |= key == 'sheaf_%d@prop' % level
        ob.hide_viewport = ob.hide_render = not want
