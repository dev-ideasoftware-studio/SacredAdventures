import re, os, sys, json
root = sys.argv[1]
imap = {"three": "vendor/three/three.module.js", "three/addons/": "vendor/three/examples/jsm/"}
def resolve(spec, frm):
    if spec in imap: return imap[spec]
    for k, v in imap.items():
        if k.endswith("/") and spec.startswith(k): return v + spec[len(k):]
    if spec.startswith("."):
        return os.path.normpath(os.path.join(os.path.dirname(frm), spec.split("?")[0]))
    return None
html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
seeds = []
for m in re.finditer(r'<script([^>]*)>(.*?)</script>', html, re.S):
    attrs, body = m.group(1), m.group(2)
    src = re.search(r'src="([^"]+)"', attrs)
    if src and not src.group(1).startswith("http"): seeds.append(("index.html<script src>", os.path.normpath(src.group(1).split("?")[0])))
    if 'type="module"' in attrs:
        for s in re.findall(r'''(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]''', body):
            r = resolve(s, "index.html")
            if r: seeds.append(("index.html<inline module>", r))
seen, edges, dyn = {}, [], []
stack = [s[1] for s in seeds]
while stack:
    f = stack.pop()
    if f in seen or f.startswith("vendor/"): seen.setdefault(f, 1); continue
    p = os.path.join(root, f)
    if not os.path.exists(p): seen[f] = "MISSING"; continue
    seen[f] = 1
    if not f.endswith(".js"): continue
    src = open(p, encoding="utf-8").read()
    src_nc = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src_nc = re.sub(r'(?m)^\s*//.*$', '', src_nc)
    for s in re.findall(r'''(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]''', src_nc, re.M):
        spec = s[0] or s[1]
        r = resolve(spec, f)
        if r: edges.append((f, r)); stack.append(r)
    for s in re.findall(r'''import\(\s*['"`]([^'"`]+)['"`]\s*\)''', src_nc):
        r = resolve(s, f)
        if r: dyn.append((f, r)); stack.append(r)
reg = re.findall(r'orc\.register\((\w+)', html)
act = re.findall(r'''orc\.activate\(\s*['"]([^'"]+)['"]''', html)
live = sorted(k for k, v in seen.items() if v == 1 and not k.startswith("vendor/"))
out = {"seeds": seeds, "live_files": live, "missing": [k for k, v in seen.items() if v == "MISSING"],
       "dynamic_imports": dyn, "registered": reg, "activated": act}
json.dump(out, open(sys.argv[2], "w"), indent=1)
print("live files:", len(live), "| missing:", out["missing"], "| dynamic:", len(dyn), "| registered:", len(reg), "| activated:", len(act))
print("seeds:", [s[1] for s in seeds][:8], "...")
print("non-(v2/sanctuary) live files:", [f for f in live if not f.startswith(("js/v2/", "js/sanctuary/"))])
