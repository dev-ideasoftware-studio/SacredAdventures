═══════════════════════════════════════════════════════════════════════
COORDINATION HANDOFF — TURTLE, ROCKS, COMPRESSED AVATAR, & HUD ACCORDION
═══════════════════════════════════════════════════════════════════════

Heads-up — Antigravity has pushed several important updates to `dev/ideasoftware-studio` ending at commit `666eb11`. 

⚠️ IMPORTANT: DO NOT force push, rewrite, or reset the branch. Please run `git pull` or `git pull --rebase` to sync cleanly. We must maintain a clean linear history!

Here is a summary of the completed work now live in the repository:

### 1. Sanctuary Pool Visual Upgrades
- **Photorealistic Sleepy Turtle**: Upgraded the procedural turtle in `js/sanctuary/SanctuaryPool.js` with a beautiful custom scutes canvas texture, concentric age growth rings, mossy camouflage detailing, 3D flared marginal scutes rim, flat aligned plastron belly plate, physical 3D sleepy eyelids (theta-limited semi-spheres covering 65% of eyes), and webbed clawed limbs (angled thighs, feet, and tan horn claws). Throttled swim crawl and breathing bobbing animation rates by 4x–5x for an ultra-slow, peaceful pond-bottom gait.
- **Procedural River Rocks**: Scattered 130 flat-shaded dodecahedron and icosahedron river stones covering ~40% of the pool floor basin, vertically compressed and elongated for organic worn appearance. Placed deterministically using `mulberry32(0xbeadca1a)` between radius 0.65m and 10.5m, safely avoiding the center bronze drain ring.

### 2. Draco-Compressed Testing Avatar
- **Draco Compression**: Compressed `Assets/npc/Avatar-New.glb` using the native gltf-transform Draco encoding pipeline. File size has dropped from **20.34 MB to 11.44 MB** (a **43.7%** reduction saving **8.90 MB** in transfer).
- **Dynamic Switch**: Programmed `SanctuaryAvatar.js` and `WorldAvatar.js` to look for the `avatar=new` substring in the URL (`window.location.href.includes("avatar=new")`). When active, it dynamically loads `./Assets/npc/Avatar-New.glb` instead of the default `./Assets/Avatar3.glb`.
- **Robust Named Animations Lookup**: Refactored animation mappers to search case-insensitively for action names (like `"idle"`, `"walk"`, `"wave"`, `"sit"`, `"goodbye"`) first, falling back gracefully to Tripo indices `[4, 3, 6, 2]` if not matched.

### 3. FPS Panel Alignment & Service Worker Cache Busting
- **Orchestrator Accordion Test Refactor**: Refactored `tests/v4-fps-orc-accordion.spec.js` to target the unified neomorphic `#v2-orchestrator-hud` panel, updating all selectors (e.g. mapping `#v4-fps-hud` to `#v2-orchestrator-hud`, `#hud-fps` to `#v2-fps`, `#hud-orc-btn` to `#v2-hud-trace-label`, `#hud-orc-graph` to `#v2-trace-spark`, and `#hud-uni-body` to `#v2-universe-accordion-body`). The test now passes successfully.
- **Service Worker Cache Busting**: Bumped the `CACHE_VERSION` in `sw.js` and `build-info.json` from `v32` to `v33`. This forces the browser to discard cached shell/assets and load our latest optimized scripts immediately.

═══════════════════════════════════════════════════════════════════════
COORDINATION HANDOFF COMPLETE — YOUR TURN TO SYNC CLEANLY
═══════════════════════════════════════════════════════════════════════
