# Les outils et accessoires de la cueillette, modelés dans Blender : faucille,
# faux, panier (4 crans : vide, un tiers, deux tiers, plein ; le contenu est un
# maillage à part, soudé au panier par le jeu) et gerbe (3 crans, le cran vide
# n'a pas de maillage).
#
# Chaque objet est décrit dans le repère de SON nœud du jeu (y en haut, le
# colon regarde +z), origine = point de prise :
#   - faucille et faux dans `toolR` (main droite, bras pendant au repos) ;
#   - panier dans `toolL` (main gauche), gerbe dans `toolL` (faucille) ou
#     dans `prop` (sur le dos, faux).
# Propriétés d'objet lues par l'export :
#   tribu_tip  = bout de l'outil (repère du nœud), mesuré par la parité ;
#   tribu_edge = couleur (linéaire) du tranchant, que le jeu reteinte selon
#                l'âge des métaux comme l'outil procédural (silex, cuivre…).
#
# Une géométrie par objet, soudée, couleur par sommet : le jeu la dessine
# avec le matériau toon du colon, sans un appel de dessin de plus.

import math

from mathutils import Vector

from settler_rig import bind, mesh_object, vertex_material
from tribu_io import g2b, rig_world_pivot, srgb

COL = {
    'shaft': srgb('#7d5d41'),     # PALETTE.trunk, la hampe des outils du jeu
    'bone': srgb('#efe6d2'),
    'flint': srgb('#cdd2d6'),     # tranchant de silex : marqueur de reteinte
    'wicker': srgb('#d0a060'),
    'wickerDark': srgb('#7a5232'),
    'leaf': srgb('#4a7340'),
    'berry': srgb('#c0392b'),
    'berryLight': srgb('#e8553f'),
    'straw': srgb('#d4ad55'),
    'ear': srgb('#ecc96b'),
    'band': srgb('#6f4c35'),
}


class Geo:
    """Géométrie en construction, repère du jeu."""

    def __init__(self):
        self.v = []
        self.f = []
        self.c = []
        self.smooth = []

    def ring(self, center, n_axis, b_axis, a, b, sides, color, phase=0.0):
        start = len(self.v)
        for i in range(sides):
            t = phase + 2 * math.pi * i / sides
            self.v.append(center + n_axis * (a * math.cos(t)) + b_axis * (b * math.sin(t)))
            self.c.append(color)
        return start

    def quads(self, r0, r1, sides, smooth, flip=False):
        for i in range(sides):
            j = (i + 1) % sides
            quad = (r0 + i, r0 + j, r1 + j, r1 + i)
            self.f.append(tuple(reversed(quad)) if flip else quad)
            self.smooth.append(smooth)

    def cap(self, r, sides, flip=False):
        face = tuple(r + i for i in range(sides))
        self.f.append(tuple(reversed(face)) if flip else face)
        self.smooth.append(False)

    def tube(self, pts, radii, sides, color, up=None, flat=1.0, smooth=True, caps=(True, True), colors=None):
        """Tube le long d'une polyligne. `up` (vecteur ou liste) oriente la
        section ; `flat` aplatit la section (lames)."""
        pts = [Vector(p) for p in pts]
        rings = []
        for k, p in enumerate(pts):
            t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
            u = Vector(up[k] if isinstance(up, list) else (up or (1, 0, 0)))
            if abs(u.normalized().dot(t)) > 0.95:
                u = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = (u - t * u.dot(t)).normalized()
            bb = t.cross(n)
            r = radii[k] if isinstance(radii, (list, tuple)) else radii
            col = colors[k] if colors else color
            rings.append(self.ring(p, n, bb, r, r * flat, sides, col))
        for k in range(len(rings) - 1):
            self.quads(rings[k], rings[k + 1], sides, smooth)
        if caps[0]:
            self.cap(rings[0], sides, flip=True)
        if caps[1]:
            self.cap(rings[-1], sides)
        return rings

    def cone(self, base, apex, r, sides, color):
        base, apex = Vector(base), Vector(apex)
        t = (apex - base).normalized()
        u = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        n = (u - t * u.dot(t)).normalized()
        r0 = self.ring(base, n, t.cross(n), r, r, sides, color)
        tip = len(self.v)
        self.v.append(apex)
        self.c.append(color)
        for i in range(sides):
            self.f.append((r0 + i, r0 + (i + 1) % sides, tip))
            self.smooth.append(True)
        self.cap(r0, sides, flip=True)

    def octa(self, c, r, color):
        c = Vector(c)
        s = len(self.v)
        for d in ((r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r)):
            self.v.append(c + Vector(d))
            self.c.append(color)
        for a, b, cc in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            self.f.append((s + a, s + b, s + cc))
            self.smooth.append(True)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


# ── Les outils ─────────────────────────────────────────────────────────────

def sickle():
    """Faucille : manche dans le prolongement de l'avant-bras, lame en
    croissant qui s'ouvre vers l'avant (+z) ; bras pendant, elle pointe au sol."""
    g = Geo()
    g.tube([(0, 0.07, 0), (0, -0.16, 0)], [0.032, 0.027], 6, COL['shaft'])
    g.tube([(0, -0.15, 0), (0, -0.19, 0)], 0.037, 6, COL['bone'], smooth=False)
    c = Vector((0, -0.19, 0.15))
    R = 0.15
    pts, ups, radii = [], [], []
    n = 12
    for k in range(n + 1):
        phi = math.radians(205) * k / n
        radial = Vector((0, -math.sin(phi), -math.cos(phi)))
        pts.append(c + radial * R)
        ups.append(radial)
        radii.append(0.032 * (1 - k / n) + 0.006)
    g.tube(pts, radii, 4, COL['flint'], up=ups, flat=0.28)
    return g, pts[-1]


SCYTHE_AXIS = Vector((0.12, 1.0, -0.3)).normalized()


def scythe():
    """Faux : la main droite tient le haut du manche ; au repos le manche
    monte le long du bras, lame en haut derrière l'épaule (« faux portée »).
    La poignée de la main gauche (le mancheron) est à mi-hauteur."""
    g = Geo()
    s = SCYTHE_AXIS
    g.tube([s * -0.05, s * 1.3], [0.03, 0.026], 6, COL['shaft'])
    nib = s * 0.55
    side = s.cross(Vector((1, 0, 0))).normalized()
    if side.z < 0:
        side = -side
    g.tube([nib, nib + side * 0.13], 0.022, 5, COL['shaft'])
    g.tube([s * 1.24, s * 1.33], 0.036, 6, COL['bone'], smooth=False)
    end = s * 1.3
    # La lame se couche à plat quand le manche descend de ~25° vers le sol :
    # son plan contient la direction de la lame (u) et l'avant du fauchage (w).
    u = Vector((-1, 0, 0))
    lie = math.radians(25)
    w = s * math.cos(lie) + side * math.sin(lie)
    w = (w - u * w.dot(u)).normalized()
    pts, radii = [], []
    n = 14
    for k in range(n + 1):
        t = k / n
        pts.append(end + u * (0.66 * t) + w * (0.16 * t * t))
        radii.append(0.05 * (1 - t) + 0.007)
    g.tube(pts, radii, 4, COL['flint'], up=w, flat=0.2)
    return g, pts[-1], nib + side * 0.07


BASKET = {'sides': 7, 'top': -0.14, 'bot': -0.33, 'ro': 0.155, 'rb': 0.115}


def basket():
    """Panier vide, tenu par l'anse ; il pend sous la main."""
    g = Geo()
    sides = 7
    r = -BASKET['top']
    arc = [Vector((r * math.cos(a), -r + r * math.sin(a), 0)) for a in [math.pi * k / 6 for k in range(7)]]
    g.tube(arc, 0.014, 4, COL['wickerDark'], up=(0, 0, 1), caps=(False, False))
    top, bot, ro, rb = (BASKET[k] for k in ('top', 'bot', 'ro', 'rb'))
    ax, az = Vector((1, 0, 0)), Vector((0, 0, 1))
    o_top = g.ring(Vector((0, top, 0)), ax, az, ro, ro, sides, COL['wicker'])
    o_bot = g.ring(Vector((0, bot, 0)), ax, az, rb, rb, sides, COL['wicker'])
    i_top = g.ring(Vector((0, top, 0)), ax, az, ro - 0.014, ro - 0.014, sides, COL['wickerDark'])
    i_bot = g.ring(Vector((0, bot + 0.012, 0)), ax, az, rb - 0.012, rb - 0.012, sides, COL['wickerDark'])
    g.quads(o_top, o_bot, sides, True)
    g.quads(i_top, i_bot, sides, True, flip=True)
    g.quads(o_top, i_top, sides, False, flip=True)
    g.cap(o_bot, sides)
    g.cap(i_bot, sides, flip=True)
    return g


def basket_fill(level):
    """Contenu du panier, cran 1 à 3 (un tiers, deux tiers, plein : des baies
    rouges dépassent du bord). Le jeu le soude au panier vide : le fichier ne
    porte qu'un panier."""
    g = Geo()
    sides, top, bot, ro, rb = (BASKET[k] for k in ('sides', 'top', 'bot', 'ro', 'rb'))
    if level:
        fill = {1: -0.27, 2: -0.21, 3: -0.15}[level]
        heap = {1: 0.025, 2: 0.04, 3: 0.08}[level]
        r = rb + (ro - rb) * (fill - bot) / (top - bot) - 0.016
        g.cone((0, fill, 0), (0, fill + heap, 0), r, sides, COL['leaf'])
        count = {1: 3, 2: 6, 3: 10}[level]
        for k in range(count):
            a = 2.4 * k
            rr = r * (0.75 if k % 3 else 0.3)
            y = fill + heap * (1 - rr / r) + 0.012
            col = COL['berry'] if k % 2 else COL['berryLight']
            g.octa((rr * math.cos(a), y, rr * math.sin(a)), 0.03 if level == 3 else 0.026, col)
    return g


def sheaf(level):
    """Gerbe : tiges liées, épis en bouquet en haut. level 1 à 3."""
    g = Geo()
    r = {1: 0.04, 2: 0.056, 3: 0.074}[level]
    g.tube([(0, -0.22, 0), (0, 0.15, 0)], [r * 1.12, r], 6, COL['straw'], caps=(True, False))
    g.tube([(0, -0.035, 0), (0, 0.0, 0)], r * 1.22, 6, COL['band'], smooth=False)
    g.tube([(0, 0.15, 0), (0, 0.24, 0), (0, 0.32, 0)], [r, r * 1.65, r * 0.8], 6, COL['ear'], caps=(False, True),
           colors=[COL['straw'], COL['ear'], COL['ear']])
    return g


def tools():
    """{nom: (géométrie, nœud, tip ou None, edge ou None)} ; `extra` = points
    utiles à l'animation (mancheron de la faux)."""
    out = {}
    g, tip = sickle()
    out['sickle'] = (g, 'toolR', tip, COL['flint'])
    g, tip, nib = scythe()
    out['scythe'] = (g, 'toolR', tip, COL['flint'])
    out['basket'] = (basket(), 'toolL', None, None)
    for lv in range(1, 4):
        out['basket_fill_%d' % lv] = (basket_fill(lv), 'toolL', None, None)
    for lv in range(1, 4):
        out['sheaf_%d' % lv] = (sheaf(lv), 'toolL', None, None)
    return out, {'scythe_nib': nib}


def build(arm, coll, rig):
    """Crée un objet par outil, attaché à son os au repos ; tous cachés sauf
    ceux qu'un clip montre (settler_clips.show)."""
    mat = vertex_material()
    made, extra = tools()
    objs = {}
    for name, (g, node, tip, edge) in made.items():
        pivot = rig_world_pivot(rig, node)
        verts = [g2b(v + pivot) for v in g.v]
        ob = mesh_object('Colon_outil_' + name, coll, verts, g.f, g.c, mat)
        for poly, sm in zip(ob.data.polygons, g.smooth):
            poly.use_smooth = sm
        ob['tribu_tool'] = name
        ob['tribu_node'] = node
        ob['tribu_pivot'] = list(pivot)
        if tip is not None:
            ob['tribu_tip'] = [tip.x, tip.y, tip.z]
        if edge is not None:
            ob['tribu_edge'] = list(edge)
        bind(ob, arm, node)
        ob.hide_viewport = ob.hide_render = True
        objs[name] = ob
    # La gerbe portée sur le dos (faux) : même géométrie, attachée à `prop`.
    # Pour la vue dans Blender seulement ; l'export ne lit que la première.
    for lv in range(1, 4):
        g = made['sheaf_%d' % lv][0]
        pivot = rig_world_pivot(rig, 'prop')
        ob = mesh_object('Colon_outil_sheaf_%d_dos' % lv, coll, [g2b(v + pivot) for v in g.v], g.f, g.c, mat)
        ob['tribu_view_only'] = True
        bind(ob, arm, 'prop')
        ob.hide_viewport = ob.hide_render = True
        objs['sheaf_%d@prop' % lv] = ob
    return objs, extra
