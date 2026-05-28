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
