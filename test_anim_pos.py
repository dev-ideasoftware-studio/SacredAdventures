import json
import struct

with open('Assets/NPC.YB.glb', 'rb') as f:
    f.read(12)
    length = int.from_bytes(f.read(4), 'little')
    f.read(4)
    data = f.read(length)
    j = json.loads(data)
    
    f.read(4)
    f.read(4)
    bin_data = f.read()

def check_translation(anim):
    for sampler in anim.get('samplers', []):
        output_acc_idx = sampler.get('output')
        if output_acc_idx is not None:
            acc = j['accessors'][output_acc_idx]
            type_str = acc.get('type')
            if type_str == 'VEC3': # translation or scale
                # check path in channels
                for channel in anim.get('channels', []):
                    if channel.get('sampler') == anim['samplers'].index(sampler):
                        if channel['target']['path'] == 'translation':
                            node_idx = channel['target']['node']
                            node = j['nodes'][node_idx]
                            
                            bv_idx = acc.get('bufferView')
                            if bv_idx is not None:
                                bv = j['bufferViews'][bv_idx]
                                offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                                count = acc.get('count', 0)
                                if count > 1:
                                    first_val = struct.unpack_from("<3f", bin_data, offset)
                                    max_diff = 0
                                    for k in range(1, count):
                                        val = struct.unpack_from("<3f", bin_data, offset + k*12)
                                        diff = sum(abs(v1 - v2) for v1, v2 in zip(first_val, val))
                                        if diff > max_diff:
                                            max_diff = diff
                                    if max_diff > 0.1: # Moved more than 10cm
                                        print(f"    - {node.get('name', 'unnamed')} moves by {max_diff:.3f}")
    return

for i, a in enumerate(j.get('animations', [])):
    print(f"Animation {i}: {a.get('name', 'unnamed')}")
    check_translation(a)
