# Le squelette du colon dans Blender : une armature « Colon » aux os plats,
# têtes d'os = pivots de src/render/settler-rig.json, et la vraie géométrie du
# colon (tools/export-settler-proxy.mjs) attachée rigidement à chaque os.
#
# Les os sont orientés comme les axes de l'armature (queue = tête + Y, roll 0) :
# leur repère local est celui de l'armature, une rotation d'os se lit donc
# telle quelle dans le jeu, au changement d'axes près (tribu_io).
#
# Hiérarchie de TRAVAIL : la tête, les bras et l'accessoire suivent le torse,
# les outils suivent la main. C'est ce qui permet de plier le dos sans
# recaler les épaules à la main. Le jeu, lui, garde ses six membres à plat
# sous le rig : l'export (export_settler.py) recalcule chaque nœud dans SON
# parent du jeu.

import bpy

from tribu_io import g2b, rig_world_pivot

# Parent de travail dans Blender (≠ parent du jeu pour tête, bras, prop).
AUTHOR_PARENT = {
    'body': None, 'legL': None, 'legR': None, 'cast': None,
    'head': 'body', 'armL': 'body', 'armR': 'body', 'prop': 'body',
    'toolR': 'armR', 'toolL': 'armL',
}
BONE_LEN = 0.12
LIMBS = ('body', 'head', 'armL', 'armR', 'legL', 'legR')


def colon_scene():
    """La scène de travail « Colon » (créée au besoin), 30 i/s."""
    scene = bpy.data.scenes.get('Colon') or bpy.data.scenes.new('Colon')
    scene.render.fps = 30
    scene.render.fps_base = 1
    return scene


def clear(scene):
    """Repart de zéro : tout ce que ces scripts ont créé porte le préfixe Colon."""
    for ob in list(scene.collection.all_objects):
        if ob.name.startswith('Colon'):
            bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        if coll.name.startswith('Colon'):
            bpy.data.collections.remove(coll)
    for store in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for d in list(store):
            if d.name.startswith('Colon') and d.users == 0:
                store.remove(d)


def vertex_material():
    """Un matériau qui montre les couleurs de sommets (rendu et vue Matériau)."""
    mat = bpy.data.materials.get('Colon_couleurs')
    if mat:
        return mat
    mat = bpy.data.materials.new('Colon_couleurs')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    return mat


def build_armature(scene, rig):
    coll = bpy.data.collections.new('Colon')
    scene.collection.children.link(coll)
    arm_data = bpy.data.armatures.new('Colon')
    arm = bpy.data.objects.new('Colon', arm_data)
    coll.objects.link(arm)
    arm.show_in_front = True
    win = bpy.context.window_manager.windows[0]
    prev_scene = win.scene
    win.scene = scene
    try:
        bpy.context.view_layer.objects.active = arm
        with bpy.context.temp_override(window=win, active_object=arm, object=arm):
            bpy.ops.object.mode_set(mode='EDIT')
            bones = {}
            for name in AUTHOR_PARENT:
                eb = arm_data.edit_bones.new(name)
                head = g2b(rig_world_pivot(rig, name))
                eb.head = head
                eb.tail = head + g2b((0, 0, -BONE_LEN))  # +Y Blender
                eb.roll = 0
                eb.use_deform = name in LIMBS or name.startswith('tool') or name == 'prop'
                bones[name] = eb
            for name, parent in AUTHOR_PARENT.items():
                if parent:
                    bones[name].parent = bones[parent]
                    bones[name].use_connect = False
            bpy.ops.object.mode_set(mode='OBJECT')
    finally:
        win.scene = prev_scene
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm, coll


def mesh_object(name, coll, verts_b, faces, colors, mat):
    """Un maillage aux couleurs par sommet (attribut « Col »)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts_b], [], [tuple(f) for f in faces])
    me.update()
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(colors):
        attr.data[i].color = (c[0], c[1], c[2], 1.0)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def bind(ob, arm, bone):
    """Attache rigidement un maillage à un os (modificateur Armature, poids 1)."""
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    mod = ob.modifiers.new('Colon_os', 'ARMATURE')
    mod.object = arm
    ob.parent = arm


def build_proxy(arm, coll, rig, proxy):
    mat = vertex_material()
    for name in LIMBS:
        limb = proxy['limbs'][name]
        pivot = rig_world_pivot(rig, name)
        p = limb['position']
        verts = [g2b((p[i] + pivot.x, p[i + 1] + pivot.y, p[i + 2] + pivot.z)) for i in range(0, len(p), 3)]
        c = limb['color']
        colors = [(c[i], c[i + 1], c[i + 2]) for i in range(0, len(c), 3)]
        idx = limb['index']
        faces = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, len(idx), 3)]
        ob = mesh_object('Colon_' + name, coll, verts, faces, colors, mat)
        for poly in ob.data.polygons:
            poly.use_smooth = True
        bind(ob, arm, name)


def build(rig, proxy):
    scene = colon_scene()
    clear(scene)
    arm, coll = build_armature(scene, rig)
    build_proxy(arm, coll, rig, proxy)
    return scene, arm, coll
