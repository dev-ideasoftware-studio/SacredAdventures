import json

with open('Assets/NPC.YB.glb', 'rb') as f:
    f.read(12)
    length = int.from_bytes(f.read(4), 'little')
    f.read(4)
    data = f.read(length)
    j = json.loads(data)

for i, a in enumerate(j.get('animations', [])):
    if a.get('name') == 'NlaTrack.003':
        print(f"Checking {a.get('name')}")
        nodes_animated = set()
        for sampler in a.get('channels', []):
            target = sampler.get('target', {})
            node_idx = target.get('node')
            if node_idx is not None:
                node = j['nodes'][node_idx]
                nodes_animated.add(node.get('name', 'unnamed'))
        print(f"Animated nodes: {len(nodes_animated)}")
        for n in list(nodes_animated)[:5]:
            print(f" - {n}")
