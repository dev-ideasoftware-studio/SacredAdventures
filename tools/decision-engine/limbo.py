"""Limbo-call tracer: every message / event / service / window-function / DOM-id lookup
sent by live code, matched against a receiver anywhere in live code.

Usage: python3 -I limbo.py <repo> <system.json> <out.json>
"Live" = JS reachable from index.html plus the HTML pages index.html embeds.
"""
import json, os, re, sys
from collections import defaultdict

REPO, SYSJ, OUT = sys.argv[1:4]
os.chdir(REPO)
SYS = json.load(open(SYSJ))
LIVE_JS = [f["file"] for f in SYS["files"] if not f["status"].startswith(("Legacy", "Unreferenced"))]
HTML = ["index.html", "SacredGame.Panel.html", "SacredGame.Journal.html"]
# follow nested iframes / fetched component pages recursively
_q = list(HTML)
while _q:
    page = _q.pop()
    for ref in re.findall(r"""["'`]((?:\./)?[\w./-]+\.html)""", open(page, encoding="utf-8").read()):
        cand = os.path.normpath(os.path.join(os.path.dirname(page), ref)) if not ref.startswith("js/") else os.path.normpath(ref)
        for c in (cand, os.path.normpath(ref)):
            if os.path.exists(c) and c not in HTML and not c.startswith(("index.v2", "launch")):
                HTML.append(c); _q.append(c)
SCOPE = LIVE_JS + HTML
PROSE = {"js/v2/anu/pipelineMemory.js"}  # agent memory ledger: code-like text inside strings
TEXT = {f: open(f, encoding="utf-8").read() for f in SCOPE}

def lines_of(f, rx):
    out = []
    for i, l in enumerate(TEXT[f].splitlines(), 1):
        for m in re.finditer(rx, l):
            out.append((i, m.group(1)))
    return out

def collect(rx):
    """Full-text search so calls split across lines are still found; reports the line of the match start."""
    d = defaultdict(list)
    for f in SCOPE:
        t = TEXT[f]
        for m in re.finditer(rx, t):
            name = next((g for g in m.groups() if g), None)
            ls = t.rfind(chr(10), 0, m.start()) + 1
            line = t[ls:t.find(chr(10), m.start()) if t.find(chr(10), m.start()) != -1 else len(t)].lstrip()
            in_comment = line.startswith(("//", "*", "/*")) or "//" in t[ls:m.start()]
            if name and not in_comment and f not in PROSE:
                d[name].append(f"{f}:L{t.count(chr(10), 0, m.start()) + 1}")
    return d

kinds = []

# 1. postMessage types
pm_send = collect(r"""postMessage\(\s*\{\s*type:\s*['"](\w+)['"]""")
pm_recv = collect(r"""(?:\.type|\bt|\btype|\bmsgType|\bkind)\s*===?\s*['"](\w+)['"]|case\s+['"](\w+)['"]\s*:""")
# collect() keeps group(1) only; add case-labels separately
for f in SCOPE:
    for ln, name in lines_of(f, r"""case\s+['"](\w+)['"]\s*:"""):
        pm_recv[name].append(f"{f}:L{ln}")
pm_recv.pop(None, None)
# relay lists: ['A', 'B'].includes(msg.type)
for f in SCOPE:
    t = TEXT[f]
    for m in re.finditer(r"\[([^\]]{0,600})\]\s*\.includes\(\s*[\w.]*type\s*\)", t, re.S):
        ln = t.count(chr(10), 0, m.start()) + 1
        for name in re.findall(r"['\"](\w+)['\"]", m.group(1)):
            pm_recv[name].append(f"{f}:L{ln} (relay list)")
kinds.append(("postMessage type", pm_send, pm_recv))

# 2. DOM CustomEvents
ce_send = collect(r"""dispatchEvent\(\s*new CustomEvent\(\s*['"]([\w:.-]+)['"]""")
ce_recv = collect(r"""addEventListener\(\s*['"]([\w:.-]+)['"]""")
kinds.append(("DOM CustomEvent", ce_send, ce_recv))

# 3. ANU InteractionBus
ab_send = collect(r"""dispatchInteraction\(\s*ANU_EVENTS\.(\w+)""")
ab_recv = collect(r"""subscribeInteraction\(\s*ANU_EVENTS\.(\w+)""")
kinds.append(("ANU bus event", ab_send, ab_recv))

# 4. Runtime services
sv_use = collect(r"""getRuntimeService\(\s*['"](\w+)['"]""")
sv_reg = collect(r"""registerRuntimeService\(\s*['"](\w+)['"]""")
kinds.append(("Runtime service lookup", sv_use, sv_reg))

# 5. window functions called vs defined
wf_call = collect(r"""window\.(\w+)\??\.?\(""")
wf_def = defaultdict(list)
for f in SCOPE:
    for ln, name in lines_of(f, r"""window\.(\w+)\s*=\s*(?:async\s*)?(?:function|\(|[A-Za-z_$][\w$]*\s*=>|[A-Za-z_$][\w$.]*\s*[;,)]?\s*$)"""):
        wf_def[name].append(f"{f}:L{ln}")
    for ln, name in lines_of(f, r"""(?:^|[\s;])function\s+(\w+)\s*\("""):
        if f.endswith(".html"):
            wf_def[name].append(f"{f}:L{ln} (global function)")
BUILTIN = {"addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout",
           "setInterval", "clearInterval", "postMessage", "open", "close", "matchMedia", "getComputedStyle", "dispatchEvent", "scrollTo",
           "fetch", "alert", "confirm", "prompt", "focus", "blur", "print", "structuredClone", "requestIdleCallback", "queueMicrotask",
           "createImageBitmap", "atob", "btoa", "getSelection", "scroll", "scrollBy", "resizeTo", "moveTo"}
for k in list(wf_call):
    if k in BUILTIN:
        wf_call.pop(k)
kinds.append(("window.* function call", wf_call, wf_def))

# 6. DOM ids looked up vs ids that exist (static HTML or created in JS)
id_get = collect(r"""getElementById\(\s*['"]([\w:-]+)['"]""")
for f in SCOPE:
    for ln, name in lines_of(f, r"""querySelector(?:All)?\(\s*['"]#([\w-]+)['"\s.>\[]"""):
        id_get[name].append(f"{f}:L{ln}")
id_def = defaultdict(list)
for f in SCOPE:
    for ln, name in lines_of(f, r"""\bid\s*=\s*['"`]([\w:-]+)['"`]"""):
        id_def[name].append(f"{f}:L{ln}")
    for ln, name in lines_of(f, r"""\.id\s*=\s*['"`]([\w:-]+)['"`]"""):
        id_def[name].append(f"{f}:L{ln}")
    for ln, name in lines_of(f, r"""\bid:\s*['"]([\w:-]+)['"]"""):
        id_def[name].append(f"{f}:L{ln}")
kinds.append(("DOM id lookup", id_get, id_def))

rows = []
for kind, send, recv in kinds:
    for name in sorted(set(send)):
        s, r = send[name], recv.get(name, [])
        cross_frame = kind == "postMessage type"
        verdict = "Has receiver" if r else "LIMBO — no receiver in live code"
        if kind == "DOM id lookup" and not r:
            verdict = "LIMBO — id not created anywhere in live code"
        if kind == "window.* function call" and not r:
            verdict = "LIMBO — never assigned in live code"
        if kind == "ANU bus event" and not r:
            verdict = "LIMBO — no code subscriber (only the DevTools AnuUniverse.interactions.subscribe API)"
        rows.append({"kind": kind, "name": name, "senders": s, "receivers": r, "verdict": verdict,
                     "note": "Receiver may sit in another frame; both frames scanned" if cross_frame else ""})
# Reverse direction (added 2026-10-22, ATT-31): custom DOM events that code LISTENS for but nothing
# dispatches. Only names with ':' or '-' are custom; built-in DOM events (click, resize, …) never have them
# except a few listed here.
_DOM_BUILTIN_DASHED = {"DOMContentLoaded", "webglcontextlost", "webglcontextrestored", "visibilitychange"}
for name in sorted(set(ce_recv) - set(ce_send)):
    if (":" in name or "-" in name) and name not in _DOM_BUILTIN_DASHED:
        rows.append({"kind": "DOM CustomEvent", "name": name, "senders": [], "receivers": ce_recv[name],
                     "verdict": "DEAF — listener never fired by live code", "note": "Check for a renamed event or an ANU bus event with a similar name"})
json.dump({"scope": SCOPE, "rows": rows}, open(OUT, "w"), indent=1)
from collections import Counter
print(Counter((r["kind"], r["verdict"].split(" —")[0]) for r in rows))
for r in rows:
    if r["verdict"].startswith("LIMBO") and r["kind"] in ("postMessage type", "Runtime service lookup", "ANU bus event"):
        print(r["kind"], r["name"], r["senders"][:2])
