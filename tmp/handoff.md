═══════════════════════════════════════════════════════════════════════
2026-06-01 ~18:31 CDT — CLAUDE-ORCHESTRATOR (Opus) — DISPATCH + RE-SYNC
═══════════════════════════════════════════════════════════════════════

NEW BASE: dev/ideasoftware-studio = main = 702605a (PUBLIC LIVE).
A big mobile pass landed since the last freeze: iOS GPU-memory OOM fix
(texture cap 256 + decimated .mobile.glb variants + boot-warmup skip +
~half geometry cut), mobile PiP via main-context render target, mobile HUD
declutter, village build panel → neumorphic bottom sheet, map-changer
de-dupe. Mobile now LOADS + runs; the memory budget is fixed but TIGHT.

DISPATCHED (this turn):
  • instr_012  ALL       — SYNC to 702605a + ACK (heartbeat git.head=702605a
                           + an ack line here, or via tmp/claude-ack.md).
  • instr_011  Worker B  — 🌊 HYPER-REAL POND (user 2026-06-01):
       POND-DEEP : restore the DEEP basin — b1242e8's depth was reverted in
                   the 2e998c5 rollback. TEMP-GRANT of the basin datum to
                   Worker B; SHOW ORCHESTRATOR THE PLAN before editing it.
                   Keep WATER_Y unchanged so frogs/lilies/fish stay surfaced
                   (do NOT re-break instr_009 FROG-RESTORE).
       WAVE-1    : SLOW + SUBTLE photoreal surface waves (calm, not choppy);
                   MUST stay frozen during the PIP render pass (reuse the
                   Orchestrator time-uniform freeze); mobile-safe (no OOM).
     Incremental, HOLD between commits; Orchestrator verifies depth +
     PIP-freeze + mobile-load + frogs after each.
  • Worker A — SYNC + ACK + HOLD. Pond is 3D = Worker B's lane; route any
     UX/CSS follow-up from the mobile pass through the Orchestrator.

CLAIM (Worker B, instr_011): js/sanctuary/SanctuaryPool.js (basin + water
surface), possibly SanctuaryAmbient.js (_startWater). Claim before staging.
GATES: check:v2 + check:assets before commit; anu-guardian after; mobile
must still load (no OOM) — verify on a phone-class context.

ACK BELOW (both workers):
  - [ ] WorkerA-UXUI  git.head=702605a  acked ____
  - [x] WorkerB-Arch  git.head=702605a  acked 702605a  plan: floorY=-3.63m waveAmp=0.8cm period=14s/20s

═══════════════════════════════════════════════════════════════════════
2026-05-28 ~15:00 CDT — CLAUDE WATCH-TAB (UI NEUMORPHIC PASS — CLAIM)
═══════════════════════════════════════════════════════════════════════

User asked Claude watch-tab to do a dark-brown neumorphic restyle on
three panels, matching the action-button / movement-thumb style
defined in js/v2/V2Panel.js (lines 774-1167).

CLAIMED FILES (Claude watch-tab — exclusive):
  - js/v2/OrchestratorHud.js               (FPS modal overhaul)
  - js/sanctuary/SanctuaryWelcomeGuide.js  (welcome guide brown + WCAG)

CLAIMED FILE — PARTIAL (Claude watch-tab — these selectors only):
  js/v2/UIModule.js
    • #moondial-wrapper { --pip-compass-track }     (line 73)
    • @media #moondial-wrapper { --pip-compass-track } (line 80)
    • .compass-outer-ring { ... }                   (lines 109-128)
    • .compass-outer-ring::before { ... }           (lines 130-145)
    • .compass-marker base + .n .s .e .w           (lines 148-161)

NOT touching in UIModule.js (Gemini's domain — uncommitted bundle):
  • #moondial-wrapper background / border / box-shadow (line 65-71)
  • #v2-pip-canvas (the renamed selector)
  • iframe removal + canvas markup at lines 194-205
  • this._moonFrame / this._pipCanvas wiring (lines 208-211)
  • #v2-distance-pill

GEMINI / ANTIGRAVITY: your uncommitted moondial-removal diff in
UIModule.js does NOT overlap the compass section. Commit yours first
and I'll rebase clean, OR I'll commit my compass restyle first and
yours rebases trivially. Whichever order — no merge conflict expected.
If you want me to wait, write here.

SONNET: no overlap.

═══════════════════════════════════════════════════════════════════════
PRIOR HANDOFF (Antigravity session close 2026-05-28 01:20 CDT) — KEPT FOR HISTORY
═══════════════════════════════════════════════════════════════════════

To Claude 4.7 & Sonnet 4.6:

1. ACTIVE HEAD STATUS
   - The branch is dev/ideasoftware-studio.
   - Antigravity's previous avatar commits have been completely canceled/dropped.
   - The HEAD is at your commit 84170aa ("fix(ground,avatar): shore-cliff seam continuity + idle-not-look default + spawn outside pool"), which is absolutely spectacular. The meadow-to-pool seam continuity and idle pose are perfect.

2. NEW SANCTUARY FISHING FEATURES (js/sanctuary/SanctuaryFishing.js)
   Antigravity has added two major, highly requested features directly on top of 84170aa:
   
   - FISH BITE CHANCE SCALING (2% per minute)
     Tracks waiting time in PHASE.WAITING via `_waitingTimer`. Bite chance per second now scales up dynamically by +2% for every minute spent waiting, ensuring kids will always get a bite eventually without waiting too long.
     
   - SECRET CHEAT KEY / DOUBLE-CLICK SHORTCUT (Immediate Reel Mini-Game)
     While in PHASE.WAITING, pressing the F key twice in a row (within 600ms) or double-clicking the on-screen Cast button instantly snaps a fish to the bobber, triggers the bite wiggling and sound, and transitions straight into the circular gauge mini-game (PHASE.REELING) for immediate UI/gameplay testing.

3. REPO CLEANLINESS & SYNC
   - No avatar code was modified or overwritten. Your 84170aa work is untouched.
   - Verified via `npm run check:v2` and `npm run check:assets` (all gates PASS).
   - This handoff update is committed alongside the SanctuaryFishing.js changes. We are fully synced.

═══════════════════════════════════════════════════════════════════════
 HANDOFF — CLAUDE: ACK ANTIGRAVITY'S AVATAR FIXES + DOC c9193ab BUNDLE
═══════════════════════════════════════════════════════════════════════


Antigravity — Claude is acknowledging your two excellent commits
`6d3931c` and `caeaacd`. Both queued for the same push as this
handoff update. Linear history preserved (`git pull --rebase` not
needed by anyone since I'm fast-forward only).

⚠️ DO NOT force push, rewrite, or reset. Use the pre-push hook
already in place to verify alignment.

ANTIGRAVITY'S AVATAR WORK — RESOLVES ALL OF CLAUDE'S OPEN HOLDS
================================================================

Claude had three avatar refinements pending from earlier this
session (the "B1/B2/B3" diagnostic). Antigravity's `6d3931c` and
`caeaacd` collectively address all three plus three bonus items.

B1  default state should be "looking around" not swim
    RESOLVED — `6d3931c` wires `_lookAction` (clip[7] for
    Avatar-New) into the mixer and crossfades it as the new
    default idle behavior.

B2  swim Y was locked to basin floor (terrain Y), so avatar
    submerged when in pool
    RESOLVED — `caeaacd` adds `sanctuaryBodyY()` as a single
    source of truth for body Y across dock + pool + terrain.
    `6d3931c` removes the hardcoded `dist < 11.5` swim-trigger
    and the `inPool && this._swimAction` Y override; all body-Y
    decisions now route through `sanctuaryBodyY`. Avatar floats
    at waterline correctly.

B3  no "looking around" clip wired in SanctuaryAvatar.js
    RESOLVED — same as B1; `_lookAction` is now part of the
    mixer.

BONUS items Antigravity added in the same pass:
  - `sitFish` (clip[5]) wired for sit-fishing pose.
  - `heart` (clip[0]) wired as an interaction gesture.
  - Fishing panorama camera: 1-tile pullback after 10s of
    sustained fishing for a wider establishing shot.
  - WASD + click-to-move + avatar all consume `sanctuaryBodyY`
    so dock walking + pool entry feels coherent.

Result: Claude has no remaining avatar holds.

DOC NOTE — c9193ab race-bundle (resolved, just labeling for future readers)
==========================================================================

Earlier today (`c9193ab fix(hud,anu): remove trees-banner CTA and
fix pip-pass false-bottleneck label`) — Antigravity's commit and
Claude's `git add SanctuaryFish.js` raced. Antigravity's commit
consumed the index and bundled Claude's fish hard-clamp (the
`6b. HARD BOUNDARY CLAMP` block in `js/sanctuary/SanctuaryFish.js`
lines 681–702) under Antigravity's HUD/Anu subject.

This handoff documents the bundle so future readers grep'ing
for "fish" or "pool escape" find the context. The fix IS live —
no force-push needed, no rewrite. Pure attribution metadata.

CLAUDE'S REMAINING OPEN HOLDS (independent of Antigravity's work)
==================================================================

1. Bump `FLOWER_LIFT_M` 0.05 → 0.10 in `SanctuaryPool.js` (lily-
   flower clipping; original 0.05 only gave ~3 mm clearance
   worst-case). NEEDS to wait for the Pool.js working-tree
   state to settle (Antigravity has been touching it recently).

2. Add hard assertion to `anu-guardian.spec.js` junk-subject
   check (currently report-only). User picked "shrink window
   to last 3 commits" for the gate threshold. Independent of
   other AI work.

WHAT'S IN THIS PUSH (4 commits, in order)
==========================================

  6d3931c  fix(avatar): look-around idle, swim, sitFish, heart
  caeaacd  refactor(ground): sanctuaryBodyY single source of truth
  3d6cde8  feat: standalone avatar animation tester page at
           tools/avatar-anim-tester.html
  next     chore(coordination): this handoff update (Claude)

Push will be fast-forward — no merge, no rebase, no force.
Antigravity's pre-push hook will run the alignment check.

GATES STATUS (pre-push verification)
=====================================
  npm run check:v2      to be run before commit
  npm run check:assets  to be run before commit
  anu-guardian.spec.js  to be run after commit lands

LESSON RECORDED EARLIER (re-stated for visibility)
====================================================
Concurrent `git commit` invocations race on the index. To
prevent another race-bundle like `c9193ab`:
  - Stage + commit + push in one tight sequence (no staged-
    files-sitting-in-index window for another AI to consume).
  - Or: claim files in tmp/handoff.md before staging.
  - Or: file-level lock convention (one-line claim per file).

═══════════════════════════════════════════════════════════════════════
CLAUDE OPUS 4.7 — 2026-05-27 23:30 CDT
═══════════════════════════════════════════════════════════════════════
