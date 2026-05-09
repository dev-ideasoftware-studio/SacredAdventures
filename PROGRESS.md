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
- FuzzyBrain adaptive FPS controller (startup immunity added)
- Lensflare — fixed (was 400px giant yellow circle, now 60px subtle)
- tipi-canvas-wrapper — fixed (was gold debug color, now transparent)
- Service Worker v8 — HTML files with ?v= now served from cache correctly
- Git history clean and committed

## 🔧 In Progress
- SW v9 — add 6 missing scripts to shell cache
- manifest.json — fix start_url + re-enable PWA install

## 📋 Next Up (in order)
1. SW v9 + manifest fix → commit → verify offline boot
2. FPS verification — get FuzzyBrain console report from browser
3. Journal 404 confirmation — Component.NewJournal.html loads clean
4. Village View audit (Pillar 1)
5. Journal/RASA audit (Pillar 2)
6. FPV interactions audit (Pillar 3)
7. NPC dialogue → Journal wiring
8. WCAG 2.2/AAA audit
9. WORDPRESS/dist sync

## ⚠️ Known Issues
- live-server MutationObserver error in console — harmless, browser extension noise, ignore
- manifest link disabled in index.html (intentional until manifest is fixed)

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
