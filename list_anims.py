import json, sys, struct
def list_anims(filename):
    with open(filename, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF': return
        version, length = struct.unpack('<II', f.read(8))
        chunk_len, chunk_type = struct.unpack('<II', f.read(8))
        if chunk_type != 0x4E4F534A: return
        json_data = f.read(chunk_len).decode('utf-8')
        data = json.loads(json_data)
        if 'animations' in data:
            print(f"--- {filename} ---")
            for i, a in enumerate(data['animations']):
                print(f"[{i}] {a.get('name', 'unnamed')}")
list_anims('Assets/NPC.BHG.glb')
list_anims('Assets/NPC.REG.glb')
