"""Mechanical hot-path scanner for one or more JS files.

Usage: python3 -I tools/decision-engine/hotscan.py <file.js> [...] > out.json

For every function/method it reports its line range, and for every line it flags:
  alloc     — `new THREE.X(` / `new Vector3(` etc. (GC pressure if in a per-frame path)
  geo       — geometry construction (`new THREE.*Geometry(`)
  mat       — material construction (`new THREE.*Material(`)
  tex       — texture construction / loading
  traverse  — scene/object traversal
  lookup    — getObjectByName / getObjectById / querySelector / getElementById
  dom       — style / classList / textContent / innerHTML writes
  matrix    — updateMatrixWorld / getWorldPosition / getWorldQuaternion / localToWorld
  dispose   — .dispose(
  scene_mut — scene.add / scene.remove / parent.add / .remove(
  physical  — MeshPhysicalMaterial features (transmission, clearcoat, sheen, ior)
  transparent — transparent: true / depthWrite: false
  layers    — layers.enable / layers.set
  culled    — frustumCulled assignments
  shadow    — castShadow / receiveShadow = true
  global_w  — window.X = ...
  random    — Math.random (non-determinism)
  log       — console.* (cost in hot path)
It also marks which functions are reachable from `update(` within the same file
(a simple same-file call graph over `this._name(` / `name(` calls).
"""
import json, re, sys

FLAGS = {
    "alloc": r"new\s+(?:THREE\.)?(?:Vector[234]|Matrix[34]|Quaternion|Euler|Color|Box3|Sphere|Raycaster|Ray|Plane)\(",
    "geo": r"new\s+THREE\.\w*Geometry\(|\.clone\(\)\s*;?\s*$|mergeGeometries\(",
    "mat": r"new\s+THREE\.\w*Material\(|material\.clone\(\)|\.material\s*=\s*\w+\.clone\(",
    "tex": r"new\s+THREE\.(?:CanvasTexture|DataTexture|Texture|VideoTexture)\(|TextureLoader\(\)|\.loadAsync\(|getContext\(['\"]2d",
    "traverse": r"\.traverse(?:Visible)?\(",
    "lookup": r"getObjectBy(?:Name|Id|Property)\(|querySelector(?:All)?\(|getElementById\(",
    "dom": r"\.style\.\w+\s*=|\.style\.setProperty|classList\.(?:add|remove|toggle)|\.(?:textContent|innerHTML|innerText)\s*=",
    "matrix": r"updateMatrixWorld\(|getWorld(?:Position|Quaternion|Scale|Direction)\(|localToWorld\(|worldToLocal\(",
    "dispose": r"\.dispose\(",
    "scene_mut": r"\b(?:scene|this\._scene|parent|root|group|g)\.(?:add|remove)\(|\.removeFromParent\(",
    "physical": r"transmission\s*:|clearcoat\s*:|sheen\s*:|ior\s*:|thickness\s*:|iridescence\s*:",
    "transparent": r"transparent\s*:\s*true|depthWrite\s*:\s*false|\.transparent\s*=\s*true",
    "layers": r"layers\.(?:enable|set)\(",
    "culled": r"frustumCulled\s*=",
    "shadow": r"(?:castShadow|receiveShadow)\s*=\s*true",
    "global_w": r"window\.\w+\s*=(?!=)",
    "random": r"Math\.random\(",
    "log": r"console\.(?:log|warn|info|debug)\(",
}
FN_HEAD = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\(|(\w+)\s*\([^)]*\)\s*\{\s*$|(\w+)\s*:\s*(?:async\s*)?function\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)"
)
KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "with"}

def scan(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    # function ranges by brace matching from header line
    fns = []
    for i, l in enumerate(lines):
        m = FN_HEAD.match(l)
        if not m:
            continue
        name = next(g for g in m.groups() if g)
        if name in KEYWORDS:
            continue
        depth, started, j = 0, False, i
        while j < len(lines):
            s = re.sub(r"//.*$", "", lines[j])
            s = re.sub(r"(['\"`])(?:\\.|(?!\1).)*\1", "", s)
            for ch in s:
                if ch == "{":
                    depth += 1; started = True
                elif ch == "}":
                    depth -= 1
            if started and depth <= 0:
                break
            j += 1
        fns.append({"name": name, "start": i + 1, "end": j + 1})
    # innermost function per line
    owner = [None] * (len(lines) + 2)
    for f in sorted(fns, key=lambda f: f["end"] - f["start"], reverse=True):
        for k in range(f["start"], f["end"] + 1):
            owner[k] = f["name"]
    hits = []
    for i, l in enumerate(lines, 1):
        code = l.split("//")[0]
        if code.strip().startswith(("*", "/*")):
            continue
        fl = [k for k, rx in FLAGS.items() if re.search(rx, code)]
        if fl:
            hits.append({"line": i, "fn": owner[i], "flags": fl, "code": l.strip()[:160]})
    # call graph from update()
    names = {f["name"] for f in fns}
    body = {f["name"]: "\n".join(lines[f["start"] - 1:f["end"]]) for f in fns}
    calls = {n: sorted({c for c in re.findall(r"(?:this\.|\b)(\w+)\s*\(", body[n]) if c in names and c != n}) for n in names}
    reach, stack = set(), [n for n in names if n == "update"]
    while stack:
        n = stack.pop()
        if n in reach:
            continue
        reach.add(n)
        stack.extend(calls.get(n, []))
    for h in hits:
        h["per_frame"] = h["fn"] in reach
    return {"file": path, "lines": len(lines), "functions": fns, "per_frame_functions": sorted(reach), "calls": calls, "hits": hits}

json.dump([scan(p) for p in sys.argv[1:]], sys.stdout, indent=1)
