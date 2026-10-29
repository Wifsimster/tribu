import hashlib
import json
import os
import urllib.request

FILES = [
    'tools/blender/tribu_io.py', 'tools/blender/settler_rig.py', 'tools/blender/settler_tools.py',
    'tools/blender/settler_clips.py', 'tools/blender/export_settler.py', 'tools/blender/build_settler.py',
    'src/render/settler-rig.json',
]


def bridge(base):
    root = os.path.join(os.path.expanduser('~'), 'tribu-colon')
    repo = os.path.join(root, 'repo')
    for rel in FILES + ['settler-proxy.json']:
        data = urllib.request.urlopen(base + rel.replace('/', '__'), timeout=30).read()
        path = os.path.join(repo, *rel.split('/')) if rel in FILES else os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
    import importlib.util
    spec = importlib.util.spec_from_file_location('build_settler', os.path.join(repo, 'tools', 'blender', 'build_settler.py'))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    out = os.path.join(root, 'out')
    report = build.run(repo, os.path.join(root, 'settler-proxy.json'), out)
    for name in ('settler-clips.glb', 'settler-tools.glb', 'report.json'):
        data = open(os.path.join(out, name), 'rb').read()
        req = urllib.request.Request(base + name, data=data, method='PUT')
        got = urllib.request.urlopen(req, timeout=30).read().decode()
        sent = hashlib.sha256(data).hexdigest()
        report.setdefault('upload', {})[name] = {'sent': sent, 'received': got, 'ok': got == sent}
    return report


print(json.dumps(bridge(BASE), indent=1, sort_keys=True))  # noqa: F821 — BASE est fourni par l'appelant
