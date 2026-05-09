import json
import struct

with open('Assets/NPC.YB.glb', 'rb') as f:
    f.read(12)
    length = int.from_bytes(f.read(4), 'little')
    f.read(4)
    data = f.read(length)
    j = json.loads(data)
    
    # Read the binary buffer
    f.read(4) # buffer length
    f.read(4) # buffer type 'BIN\0'
    bin_data = f.read()

def check_anim(anim):
    is_moving = False
    for sampler in anim.get('samplers', []):
        output_acc_idx = sampler.get('output')
        if output_acc_idx is not None:
            acc = j['accessors'][output_acc_idx]
            bv_idx = acc.get('bufferView')
            if bv_idx is not None:
                bv = j['bufferViews'][bv_idx]
                offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                count = acc.get('count', 0)
                type_str = acc.get('type')
                
                # components per element
                if type_str == 'SCALAR': num_comp = 1
                elif type_str == 'VEC2': num_comp = 2
                elif type_str == 'VEC3': num_comp = 3
                elif type_str == 'VEC4': num_comp = 4
                else: continue
                
                fmt = f"<{num_comp}f"
                size = num_comp * 4
                
                if count > 1:
                    first_val = struct.unpack_from(fmt, bin_data, offset)
                    for k in range(1, count):
                        val = struct.unpack_from(fmt, bin_data, offset + k*size)
                        for v1, v2 in zip(first_val, val):
                            if abs(v1 - v2) > 0.001:
                                return True
    return False

for i, a in enumerate(j.get('animations', [])):
    print(f"Animation {i}: {a.get('name', 'unnamed')} -> Moving? {check_anim(a)}")
