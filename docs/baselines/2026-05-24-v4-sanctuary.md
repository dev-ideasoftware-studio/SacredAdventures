# Baseline — 2026-05-24 · v4 Sanctuary

**Git tag:** `baseline/2026-05-24`  
**Commit:** `706f783` — fix(paths): remove WORDPRESS/ hardcoded asset paths  
**Branch:** `dev/ideasoftware-studio`

## ✅ What's working (Playwright-verified, 0 errors)

| System | Status |
|--------|--------|
| SancredOrchestrator boot | ✅ |
| Anu governance telemetry | ✅ |
| Sacred Pool (3-wave shader) | ✅ |
| Fish Dock + 12 trout (lazy orbit) | ✅ |
| SanctuaryCircles (gold ring + moonlight + ripples) | ✅ |
| Avatar3 + ClickToMove + KeyboardLook + Zoom | ✅ |
| Tipi 1 + Tipi 2 (GLB at Assets/Tipi.yellowbutterfly/) | ✅ |
| NPC YB + NPC BHG (seated idle) | ✅ |
| Braziers (fire + smoke) | ✅ |
| Sky + Butterflies + Mold tools | ✅ |
| Fishing system (cast → bite → catch → inventory) | ✅ |
| Fish Jumps (every 8–18 s) | ✅ |
| Day/Night toggle | ✅ |
| Weather (rain toggle) | ✅ |
| FPS HUD | ✅ |
| V2 Moondial PIP (compass + lunar + seasons) | ✅ |
| Journal (J key) | ✅ |
| Panel (P key) | ✅ |
| Ambient sound (first-click unlock) | ✅ |
| Harvest inventory (right-click flora) | ✅ |

## Asset paths (post-fix)

| Asset | Path |
|-------|------|
| Tipi GLB | `./Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb` |
| NPC BHG | `./Assets/NPC.BHG.glb` (25 MB) |
| NPC YB | `./Assets/NPC.YB.glb` (3 MB) |
| Avatar3 | `./Assets/Avatar3.glb` |
| Draco decoder | `./vendor/three/examples/jsm/libs/draco/gltf/` |
| Opening video | `Assets/landscape-scenes/cinematic/animated-opening.mp4` |

## Published repos

| Repo | URL |
|------|-----|
| Working copy | `NEW.SACREDONES` · branch `dev/ideasoftware-studio` |
| Fresh public repo | https://github.com/dev-ideasoftware-studio/SacredAdventures |
| GitHub Pages (live game) | https://dev-ideasoftware-studio.github.io/SacredAdventures/ |

## To recover to this state

```bash
git checkout baseline/2026-05-24
```

Or from the SacredAdventures repo — the initial two commits are this exact state.

## Known non-issues

- `ERR_ABORTED` on `animated-opening.mp4` in Playwright — Python http.server doesn't support HTTP range requests for video; GitHub Pages handles this correctly.
- `NPC.REG.glb` (89 MB) and `tipi.player.glb` (61 MB) excluded from SacredAdventures repo (unused by v4, exceed 50 MB GitHub recommendation). Kept in working copy.
