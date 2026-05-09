# Sacred Adventures — Progress Log
> Safety rope. Read this first before touching anything.

---

## Current Status: STABLE
**Last verified:** 05-09-2026 ~2:00am CT  
**Branch:** main  
**Server:** `python3 -m http.server 8080` → `http://localhost:8080`

---

## ✅ Working (Do Not Break)
- FPV rendering — Three.js scene, sky, fog, trees (143 instanced)
- Avatar3.glb loading and walking
- NPCs spawning — YellowButterfly, BHG Girl, NatureSpirit, REG
- Rabbits, Horses, Buffalos via MasterAI
- FuzzyBrain adaptive FPS controller (startup immunity at frame 180)
- Lensflare — fixed (was 400px giant yellow circle, now 60px subtle)
- tipi-canvas-wrapper — fixed (was gold debug color, now transparent)
- Service Worker v9 — HTML ?v= params handled, all shell files cached
- manifest.json — start_url fixed, PWA install re-enabled
- Hex grid snap — getNearestHexCenter() live in EnvironmentBuilder.js
- Orphaned js/core + js/components quarantined to _orphaned_refactor/
- Git history clean and committed

## 🔧 In Progress
- FPS verification (need browser console report)
- Journal 404 confirmation after SW v9

## 📋 Next Up (in order)
1. FPS check — browser hard refresh, report FuzzyBrain console output
2. Journal 404 — confirm Component.NewJournal.html loads clean
3. Tipi owner names — wire NPC names to building info text
4. SaveState system — localStorage auto-save/load
5. Resource sites — choppable trees, 24hr regrow timer
6. Fishery placeholder — Three.js procedural model + fisherman NPC stub
7. Main Lodge placeholder — multi-hex Three.js model
8. Journal/RASA audit (Pillar 2)
9. FPV interactions audit (Pillar 3)
10. WCAG 2.2/AAA audit
11. WORDPRESS/dist sync

## ⚠️ Known Issues
- live-server MutationObserver error in console — harmless, browser extension noise, ignore

---

## 🗺️ Game Design Spec (Mark's Vision — locked 05-09-2026)

### Buildings
| Building | Hexes | NPC | GLB Status |
|---|---|---|---|
| Main Tipi | 1 | YellowButterfly | ✅ Live |
| BHG Tipi | 1 | Brings Happiness Girl | ✅ Live |
| REG Tipi | 1 | REG | ✅ Live |
| Main Lodge | multi | Elder (TBD) | 🔲 Three.js placeholder |
| Fishery | 1-2 | Fisherman NPC | 🔲 Three.js placeholder |

### Resource System
- **Trees** — choppable in FPV → drop Wood → magically regrow after 24 real hours
- **Fishing spots** — near water → drop Fish resource
- **Resource sites** — special map areas that yield multiple units per visit
- More types TBD: berry patches, clay deposits

### Save State (localStorage key: `sacredAdventures_saveState`)
Must persist across sessions:
- Player position + rotation
- Village build state (hex → building map)
- Resource inventory (wood, fish, etc.)
- Tree regrow timestamps
- Quest completion flags
- NPC relationship levels (bunny befriending, etc.)
- Game time offset
- Auto-save: every 60s + on page unload

## 🛑 Do Not Touch Without Reading First
- `Component.FuzzyBrain.js` — carefully tuned, startup immunity at frame 180
- `sw.js` — two-tier cache, always run `node --check sw.js` after edits
- `js/Component.PostProcessing.js` — lensflare size is intentionally 60px
- `js/EngineMain.js` — tipi-canvas-wrapper background must stay `transparent`

## Working Agreement (Cas + Mark)
- Verify before commit. Commit before moving on.
- Own mistakes immediately. Never mask root cause.
- Two failed attempts = stop and rethink together.
- Adapt and Overcome is the modus operandi.
