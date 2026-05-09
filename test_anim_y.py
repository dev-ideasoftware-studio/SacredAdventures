import json, struct
def get_anim_y(filename):
    with open(filename, 'rb') as f:
        magic = f.read(4)
        if magic != b'glTF': return
        f.read(8) # version, length
        chunk_len, chunk_type = struct.unpack('<II', f.read(8))
        json_data = f.read(chunk_len).decode('utf-8')
        data = json.loads(json_data)
        
        # We don't need to read the binary buffer, we can just look at the glTF structure
        # Actually reading the binary buffer is hard without a library.
        # But maybe we can see if there is any metadata.
        print(f"File: {filename}")
        for i, anim in enumerate(data.get('animations', [])):
            print(f" Anim {i}: {anim.get('name')}")
            # we can't easily read the Y values without parsing the accessors.
            
get_anim_y('Assets/NPC.BHG.glb')
