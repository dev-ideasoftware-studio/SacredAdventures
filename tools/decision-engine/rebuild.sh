#!/usr/bin/env bash
# Rebuild the Decision Engine from the code as it is right now.
# Run from anywhere inside the repo:  bash tools/decision-engine/rebuild.sh
# Needs: python3 + openpyxl, node + the repo's devDependencies (npm install).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
T=tools/decision-engine
D=docs/decision-engine
mkdir -p "$D/data"
python3 -I "$T/extract.py" . "$D/data/system.json"
python3 -I "$T/limbo.py" . "$D/data/system.json" "$D/data/limbo.json"
# measure every GLB live code references + the mobile variants + the assets they replaced
GLBS=$(python3 -I - "$D/data/system.json" "$D/data/variants.json" <<'PY'
import json, os, sys
s = json.load(open(sys.argv[1])); v = json.load(open(sys.argv[2]))
live = {a for f in s["files"] if not f["status"].startswith(("Legacy", "Unreferenced")) for a in f["assets"]}
extra = {x[k] for x in v.values() for k in ("prev_file", "mobile_file")}
print(" ".join(sorted(a for a in live | extra if a.endswith((".glb", ".gltf")) and os.path.exists(a))))
PY
)
node "$T/glbjson.mjs" "$D/data/assets.json" $GLBS
python3 -I "$T/build_engine.py" . "$D/data/system.json" "$D/data/assets.json" "$D/data/variants.json" "$D/Decision_Engine.xlsx" "$D/data/limbo.json"
echo "Rebuilt $D/Decision_Engine.xlsx — open it and search for 'NOT FOUND' (stale evidence)."
