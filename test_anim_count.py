import json
with open('Assets/NPC.YB.glb', 'rb') as f:
    f.read(12)
    length = int.from_bytes(f.read(4), 'little')
    f.read(4)
    data = f.read(length)
    j = json.loads(data)

for i, a in enumerate(j.get('animations', [])):
    max_keyframes = 0
    for sampler in a.get('samplers', []):
        input_acc_idx = sampler.get('input')
        if input_acc_idx is not None:
            acc = j['accessors'][input_acc_idx]
            count = acc.get('count', 0)
            if count > max_keyframes:
                max_keyframes = count
    print(f"Animation {i}: {a.get('name', 'unnamed')} Max Keyframes: {max_keyframes}")
