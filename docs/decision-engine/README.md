# Decision Engine

`Decision_Engine.xlsx` is the shared map of the live game for every agent and human working on Sacred Adventures. Read it before changing code, and update it after.

## How to use it

1. Start at `00_Index`. Each tab is one level deeper than the last: system → subsystems → modules → contracts → evidence → plan → session.
2. For a symptom, open `62_Review_Playbook`. It names the penetration point (file and line) and the mechanical check to run.
3. Before trying a fix, search `63_Attempts_Ledger`. Rows marked "Do not retry" already failed.
4. Before editing a file, read its row in `30_Modules` and its edges in `40_Connections`.
5. If a call seems to do nothing, look it up in `44_Limbo_Calls`.

## Zero-trust rules

- "Assumed" columns hold what comments and docs say. Treat them as stale.
- "Verified" columns hold only what the scripts measured.
- Every evidence cell is re-located in source by regex on each rebuild. `NOT FOUND` means the code moved and the claim must be re-checked.

## After any code change

```bash
bash tools/decision-engine/rebuild.sh
```

Then:

- update `60_Plan` status;
- append a row to `63_Attempts_Ledger`, whether it worked or failed;
- append to `70_Session_Log`.

Plan, attempts, findings, claims and decisions live in `tools/decision-engine/build_engine.py`. Edit them there, so the next rebuild keeps them.

## Tools

| Script | Does |
| --- | --- |
| `extract.py` | Import graph from both entry pages; per-file status, globals, events, services, assets, per-frame hazards |
| `limbo.py` | Matches every message, event, service, `window.*` call and DOM id to a live receiver |
| `glbjson.mjs` | Triangles, textures and VRAM per GLB |
| `lite.mjs` | Decimate + downsize textures + Draco (`node lite.mjs in.glb out.glb <tris> <maxTexPx>`) |
| `skincheck.mjs` | Joints, skin weights and animation clips survive a decimation |
| `dump.mjs` + `raster.py` | Offline per-pixel preview of a model (no browser needed) |
| `build_engine.py` | Writes the workbook |

Nothing here measures runtime FPS. Runtime checks happen in a browser on a real machine.
