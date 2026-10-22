"""Mechanically extract the Sacred Adventures live system into JSON.

Run from the repo root:  python3 -I extract.py <repo> <out.json>
Everything here is derived from source text; nothing is typed by hand.
"""
import json, os, re, sys, subprocess

REPO, OUT = sys.argv[1], sys.argv[2]
os.chdir(REPO)

INDEX = open("index.html").read()
COMMIT = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()

# ── 1. Live import graph from index.html ────────────────────────────────
IMPORT_RE = re.compile(r"""(?:from\s*|import\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]+\.js)['"]""")
roots = [os.path.normpath(m.group(1)) for m in re.finditer(r"""['"](\./js/[^'"]+\.js)['"]""", INDEX)]
graph, seen, stack = {}, set(), list(roots)
while stack:
    f = stack.pop()
    if f in seen or not os.path.exists(f):
        continue
    seen.add(f)
    src = open(f).read()
    deps = []
    for m in IMPORT_RE.finditer(src):
        d = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        if os.path.exists(d):
            deps.append(d)
            stack.append(d)
    graph[f] = sorted(set(deps))
import glob
CANON = sorted(glob.glob("js/sanctuary/*.js") + glob.glob("js/v2/*.js") + glob.glob("js/v2/anu/*.js"))
DEAD = [f for f in CANON if f not in graph]
# Reachability from the older entry page (zero-trust: "not in index.html" != "unused")
V2SRC = open("index.v2.html").read()
v2seen, v2stack = set(), [os.path.normpath(m.group(1)) for m in re.finditer(r"""['"](\./js/[^'"]+\.js)['"]""", V2SRC)]
while v2stack:
    f = v2stack.pop()
    if f in v2seen or not os.path.exists(f):
        continue
    v2seen.add(f)
    for m in IMPORT_RE.finditer(open(f).read()):
        v2stack.append(os.path.normpath(os.path.join(os.path.dirname(f), m.group(1))))
for f in DEAD:
    src = open(f).read()
    graph_dead_deps = []
    for m in IMPORT_RE.finditer(src):
        d = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        if os.path.exists(d):
            graph_dead_deps.append(d)
    graph[f] = sorted(set(graph_dead_deps))
imported_by = {f: [] for f in graph}
for f, deps in graph.items():
    for d in deps:
        imported_by.setdefault(d, []).append(f)

# ── 2. Registration / activation in index.html ──────────────────────────
reg_names = re.findall(r"orc\.register\((\w+)\)", INDEX)
act_lines = INDEX.splitlines()
activated, commented_out = [], []
for ln in act_lines:
    m = re.search(r"await orc\.activate\('(\w+)'\)", ln)
    if m:
        (commented_out if ln.strip().startswith("//") else activated).append(m.group(1))
import_binding = {}  # exported symbol -> file
for m in re.finditer(r"import\s*\{([^}]*)\}\s*from\s*'(\./js/[^']+)'", INDEX):
    for sym in m.group(1).split(","):
        sym = sym.strip()
        if not sym:
            continue
        parts = sym.split(" as ")
        import_binding[parts[-1].strip()] = os.path.normpath(m.group(2))

orc_src = open("js/v2/Orchestrator.js").read()
fish_suspend = set(re.findall(r"'(\w+)'", re.search(r"FISHING_SUSPEND_MODULES = new Set\(\[(.*?)\]\)", orc_src, re.S).group(1)))

# ── 3. Per-file facts ───────────────────────────────────────────────────
HAZ = {
    "traverse": r"\.traverse\(",
    "alloc_three": r"new THREE\.(?:Vector[234]|Matrix[34]|Quaternion|Euler|Color|Box3|Raycaster|AmbientLight)\(",
    "dom_query": r"(?:querySelector|getElementById|getElementsBy)",
    "layout_read": r"(?:getBoundingClientRect|offsetWidth|offsetHeight|getComputedStyle)",
    "dom_write": r"(?:innerHTML|textContent)\s*=",
    "matrix_update": r"updateMatrixWorld\(true\)|getWorld(?:Position|Quaternion)",
}

def header(src):
    m = re.match(r"\s*/\*\*(.*?)\*/", src, re.S)
    if not m:
        return ""
    lines = [re.sub(r"^\s*\*\s?", "", l).strip() for l in m.group(1).splitlines()]
    text = " ".join(l for l in lines if l)
    text = re.sub(r"\s+", " ", text)
    return text[:600]

def update_body(src):
    m = re.search(r"\n\s*update\s*\([^)]*\)\s*\{", src)
    if not m:
        return None, None
    i, d = m.end(), 1
    while d and i < len(src):
        d += (src[i] == "{") - (src[i] == "}")
        i += 1
    return src[m.end():i], src[: m.start()].count("\n") + 2

def module_name(src):
    m = re.search(r"\bname:\s*['\"](\w+)['\"]", src)
    return m.group(1) if m else ""

GLOBAL_W = re.compile(r"window\.(\w+)\s*=(?!=)")
GLOBAL_R = re.compile(r"window\.(\w+)")
EV_DISPATCH = re.compile(r"dispatchInteraction\(\s*ANU_EVENTS\.(\w+)")
EV_SUB = re.compile(r"subscribeInteraction\(\s*ANU_EVENTS\.(\w+)")
DOM_EV_DISPATCH = re.compile(r"dispatchEvent\(\s*new CustomEvent\(\s*['\"]([\w:-]+)")
DOM_EV_LISTEN = re.compile(r"addEventListener\(\s*['\"]([\w:-]+)")
POSTMSG_TYPE = re.compile(r"postMessage\(\s*\{\s*type:\s*['\"](\w+)")
ASSET = re.compile(r"""['"`](?:\./)?(Assets/[^'"`]+\.(?:glb|gltf|png|jpg|jpeg|webp|mp3|mp4))['"`]""")
SERVICE_REG = re.compile(r"registerRuntimeService\(\s*['\"](\w+)")
SERVICE_GET = re.compile(r"getRuntimeService\(\s*['\"](\w+)")
DOMAIN = re.compile(r"Anu domain:\s*([A-Z_]+)")

files = []
for f in sorted(graph):
    src = open(f).read()
    body, uline = update_body(src)
    hz = {k: len(re.findall(p, body)) for k, p in HAZ.items()} if body else {}
    every = re.findall(r"frameCount\s*%\s*(\d+)", body or "")
    name = module_name(src)
    binding = [k for k, v in import_binding.items() if v == f]
    reg = [b for b in binding if b in reg_names]
    # map registered symbol -> module name used in activate()
    files.append({
        "file": f,
        "layer": ("Engine shell" if f in ("js/v2/Orchestrator.js", "js/v2/OrchestratorHud.js", "js/v2/RuntimeServices.js")
                  else "ANU governance" if f.startswith("js/v2/anu/") or f in ("js/v2/AnuModule.js", "js/sanctuary/AnuAdaptiveDpr.js")
                  else "Sanctuary world" if f.startswith("js/sanctuary/")
                  else "v2 shared"),
        "lines": src.count("\n") + 1,
        "kb": round(os.path.getsize(f) / 1024, 1),
        "module_name": name,
        "registered_symbol": ", ".join(reg),
        "header": header(src),
        "anu_domain_claimed": ", ".join(sorted(set(DOMAIN.findall(src)))),
        "has_update": body is not None,
        "update_line": uline,
        "update_lines": body.count("\n") if body else 0,
        "update_throttle": ", ".join(f"every {e}f" for e in sorted(set(every), key=int)),
        "hazards": {k: v for k, v in hz.items() if v},
        "imports": graph[f],
        "imported_by": sorted(set(imported_by.get(f, []))),
        "globals_written": sorted(set(GLOBAL_W.findall(src))),
        "globals_read": sorted(set(GLOBAL_R.findall(src)) - set(GLOBAL_W.findall(src))),
        "anu_events_dispatched": sorted(set(EV_DISPATCH.findall(src))),
        "anu_events_subscribed": sorted(set(EV_SUB.findall(src))),
        "dom_events_dispatched": sorted(set(DOM_EV_DISPATCH.findall(src))),
        "dom_events_listened": sorted(set(DOM_EV_LISTEN.findall(src))),
        "postmessage_types": sorted(set(POSTMSG_TYPE.findall(src))),
        "assets": sorted(set(ASSET.findall(src))),
        "services_registered": sorted(set(SERVICE_REG.findall(src))),
        "services_used": sorted(set(SERVICE_GET.findall(src))),
        "last_commit": subprocess.run(["git", "log", "-1", "--format=%ad %s", "--date=short", "--", f],
                                      capture_output=True, text=True).stdout.strip(),
        "commit_count": int(subprocess.run(["git", "rev-list", "--count", "HEAD", "--", f],
                                           capture_output=True, text=True).stdout.strip() or 0),
    })

# registered-name -> activation status
sym_to_name = {}
for fr in files:
    for sym in fr["registered_symbol"].split(", "):
        if sym:
            sym_to_name[sym] = fr["module_name"]
for fr in files:
    fr["also_in_v2_build"] = fr["file"] in v2seen
    n = fr["module_name"]
    if fr["file"] in DEAD:
        fr["status"] = ("Legacy v2 build only (index.v2.html)" if fr["file"] in v2seen
                        else "Unreferenced by any entry page")
    elif fr["registered_symbol"]:
        fr["status"] = ("Active" if n in activated else
                        "Registered, activation commented out" if n in commented_out else
                        "Registered, never activated")
    elif fr["imported_by"] or f in roots:
        fr["status"] = "Imported library (no module lifecycle)"
    else:
        fr["status"] = "Imported library (no module lifecycle)"
    fr["activation_order"] = activated.index(n) + 1 if n in activated else None
    fr["fishing_suspended"] = n in fish_suspend

# activated names not backed by an index.html registration (e.g. PanelsPIP)
orphan_activations = [a for a in activated if a not in {fr["module_name"] for fr in files if fr["registered_symbol"]}]

json.dump({
    "commit": COMMIT,
    "roots": roots,
    "registered": reg_names,
    "activated": activated,
    "activation_commented_out": commented_out,
    "orphan_activations": orphan_activations,
    "fishing_suspend": sorted(fish_suspend),
    "dead": DEAD,
    "v2_reachable": sorted(v2seen),
    "files": files,
}, open(OUT, "w"), indent=1)
print("files", len(files), "registered", len(reg_names), "activated", len(activated),
      "commented", commented_out, "orphans", orphan_activations)
