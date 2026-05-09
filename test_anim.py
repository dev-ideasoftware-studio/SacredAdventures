import json

with open('Assets/NPC.YB.glb', 'rb') as f:
    f.read(12)
    length = int.from_bytes(f.read(4), 'little')
    f.read(4)
    data = f.read(length)
    j = json.loads(data)

def is_animated(anim):
    for sampler in anim.get('samplers', []):
        output_acc_idx = sampler.get('output')
        if output_acc_idx is not None:
            acc = j['accessors'][output_acc_idx]
            min_val = acc.get('min')
            max_val = acc.get('max')
            if min_val and max_val:
                for mi, ma in zip(min_val, max_val):
                    if abs(ma - mi) > 0.001:
                        return True
            else:
                # no min/max precomputed, maybe it's animated?
                return "Unknown"
    return False

for i, a in enumerate(j.get('animations', [])):
    print(f"{a.get('name')} -> Animated? {is_animated(a)}")
