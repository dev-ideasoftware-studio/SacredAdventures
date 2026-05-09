import json

def print_durations(file_name):
    with open(file_name, 'rb') as f:
        f.read(12)
        length = int.from_bytes(f.read(4), 'little')
        f.read(4)
        data = f.read(length)
        j = json.loads(data)
        
        print(f"\n--- {file_name} ---")
        for i, a in enumerate(j.get('animations', [])):
            max_time = 0
            for sampler in a.get('samplers', []):
                input_acc_idx = sampler.get('input')
                if input_acc_idx is not None:
                    acc = j['accessors'][input_acc_idx]
                    max_val = acc.get('max', [0])[0]
                    if max_val > max_time:
                        max_time = max_val
            print(f"Animation {i}: {a.get('name', 'unnamed')} Duration: {max_time} seconds")

print_durations('Assets/NPC.YB.glb')
print_durations('Assets/NPC.REG.glb')
print_durations('Assets/NPC.BHG.glb')
