import json
import math
import struct

from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30


def g2b(v):
    return Vector((v[0], -v[2], v[1]))


def b2g(v):
    return Vector((v[0], v[2], -v[1]))


def qg2b(q):
    return Quaternion((q.w, q.x, -q.z, q.y))


def qb2g(q):
    return Quaternion((q.w, q.x, q.z, -q.y))


C_B2G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
C_G2B = C_B2G.inverted()


def euler(e):
    """Euler du jeu (three.js, ordre 'XYZ' : R = Rx·Ry·Rz) en quaternion du jeu.
    L'ordre 'ZYX' de mathutils donne la même matrice Rx·Ry·Rz."""
    return Euler((e[0], e[1], e[2]), 'ZYX').to_quaternion()


def srgb(hexstr):
    """Couleur '#rrggbb' en RVB linéaire, comme three.js (Color + gestion des
    couleurs) la range dans les sommets."""
    out = []
    for i in (1, 3, 5):
        c = int(hexstr[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def rig_world_pivot(rig, name):
    """Pivot d'un nœud dans l'espace du rig, parents du jeu compris (au repos,
    sans rotation : seuls les pivots s'additionnent)."""
    node = rig['nodes'][name]
    p = Vector(node['pivot'])
    if node['parent']:
        p = p + rig_world_pivot(rig, node['parent'])
    return p


FLOAT = 5126
USHORT = 5123


class Glb:
    """Accumule les accesseurs d'un glb, alignés sur 4 : une vue par accesseur,
    ou une seule vue pour tous (`one_view`, les animations : des centaines
    d'accesseurs, autant de vues qui ne coûteraient que du JSON)."""

    def __init__(self, one_view=False):
        self.one_view = one_view
        self.bin = bytearray()
        self.json = {'asset': {'version': '2.0', 'generator': 'tribu tools/blender (Blender 5.2)'},
                     'buffers': [], 'bufferViews': [], 'accessors': []}

    def add(self, values, ctype, atype, minmax=False):
        width = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[atype]
        assert len(values) % width == 0
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        fmt = '<%d%s' % (len(values), 'f' if ctype == FLOAT else 'H')
        self.bin += struct.pack(fmt, *values)
        if self.one_view:
            acc = {'bufferView': 0, 'byteOffset': off}
        else:
            self.json['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(self.bin) - off})
            acc = {'bufferView': len(self.json['bufferViews']) - 1}
        acc.update({'componentType': ctype, 'count': len(values) // width, 'type': atype})
        if minmax:
            packed = struct.unpack(fmt, struct.pack(fmt, *values))
            acc['min'] = [min(packed[i::width]) for i in range(width)]
            acc['max'] = [max(packed[i::width]) for i in range(width)]
        self.json['accessors'].append(acc)
        return len(self.json['accessors']) - 1

    def bytes(self):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.json['buffers'] = [{'byteLength': len(self.bin)}]
        if self.one_view:
            self.json['bufferViews'] = [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(self.bin)}]
        js = json.dumps(self.json, separators=(',', ':'), sort_keys=True).encode('utf-8')
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        out = struct.pack('<III', 0x46546C67, 2, total)
        out += struct.pack('<II', len(js), 0x4E4F534A) + js
        out += struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin)
        return out


def r6(v):
    """Arrondi des nombres écrits dans le JSON du glb : un fichier stable d'un
    export à l'autre, et lisible."""
    return round(float(v), 6)
