# Assets taxonomy

Use **five top-level domains** only. Everything in `Assets/` should eventually live under one of these folders so loaders, designers, and ANU domain tags stay aligned.

```
Assets/
├── flora/              # Plants, trees, crops, vegetation atlases
├── fauna/              # Wild animals, insects, fish, mounts (non-speaking)
├── npc/                # People, spirits, quest givers, playable avatars
├── buildings/          # Structures, architecture, large props tied to a place
└── landscape-scenes/   # Terrain, ground, sky, water, rocks, hero scene frames, world-scale media
```

> **Migration status (2026-05-16):** the five domain folders now exist, plus the first wave of moves is done — the orphan `Animated Animal Pack-glb 3/` (with spaces in the name) and the entire `landscape-scenes` domain (textures, audio, cinematic, presentation imgs) have been migrated. See *Migration status* at the bottom of this file for the per-file diff and what is still pending.

## Rules (short)

1. **One primary domain per asset** — if it could fit two, pick the *gameplay* owner (e.g. ridable horse → `fauna`; same mesh as NPC mount in a cutscene → still `fauna` unless it is only used as an NPC rig).
2. **Folder names** — lowercase, hyphenated (`yellow-butterfly/`), no spaces.
3. **File names** — prefer `domain.kind.variant.ext` (e.g. `npc.yb.glb`, `fauna.bird.glb`). Legacy names can stay until you migrate; update code paths in the same PR as moves.
4. **Bundles** — keep a small folder per asset pack (`buildings/tipi-yellow-butterfly/tipi.yellowbutterfly.glb` + sidecars).
5. **Textures** — under the same domain as the mesh they primarily serve (`flora/pine-tree/branch2.png`). Generic ground tiles → `landscape-scenes/terrain/`.
6. **Audio / video** — world ambience and non-dialog music → `landscape-scenes/audio/` or `landscape-scenes/cinematic/`. Character voice lines would go with `npc/` when you add them.
7. **UI / brand** — icons, journal chrome, PWA assets: until you add a sixth bucket, use `landscape-scenes/presentation/` (world-facing) or keep at root and list them below as *unclassified*.

## What each domain holds

| Domain | Includes | Excludes |
|--------|----------|----------|
| **flora** | `tree.glb`, pine branches, bark, grass atlases for terrain vegetation | Generic rock ground (→ landscape) |
| **fauna** | `Bird.glb`, `Buffalo.glb`, `Horse.glb`, `Fish/`, rabbits, stags, butterflies, `rabbit.animated.glb` | Humanoid quest NPCs (→ npc) |
| **npc** | `NPC.*.glb`, `TraderJosh3d.glb`, `Avatar2.glb`, `Avatar3.glb`, `animated.avatar.glb`, `animated.bringshappiness.glb` | Tipi shell (→ buildings) |
| **buildings** | `tipi.bringshappiness.obj`, `Tipi.yellowbutterfly/`, `axe.glb` + `AxeData.js` if treated as place prop | Player body default (→ npc) |
| **landscape-scenes** | `grass_seamless.png`, `rock.png`, `water.png`, `bark.png` if used as ground/cliff, `VillagePreview_New.png`, `AnimatedOpening.mp4`, `birdsong.mp3` | Tree trunk model (→ flora) |

## Current files → suggested home

| Current path | Suggested domain / subfolder |
|--------------|------------------------------|
| `tree.glb` | `flora/trees/` |
| `PineTree/` | `flora/trees/pine-tree/` |
| `Bird.glb`, `Buffalo.glb`, `Horse.glb` | `fauna/` |
| `Fish/fish.obj` | `fauna/fish/` |
| `Rabbit.obj`, `rabbit.animated.glb` | `fauna/small-mammals/` |
| `animated.stag.glb`, `animated.yellowbutterfly.glb` | `fauna/` |
| `NPC.BHG.glb`, `NPC.REG.glb`, `NPC.YB.glb` | `npc/` |
| `TraderJosh3d.glb` | `npc/` |
| `Avatar2.glb`, `Avatar3.glb`, `animated.avatar.glb`, `animated.bringshappiness.glb` | `npc/avatars/` |
| `tipi.bringshappiness.obj` | `buildings/tipi/` |
| `Tipi.yellowbutterfly/tipi.yellowbutterfly.glb` | `buildings/tipi-yellow-butterfly/` |
| `axe.glb`, `AxeData.js` | `buildings/props/` or `npc/gear/` (pick one convention and stick to it) |
| `grass_seamless.png`, `rock.png`, `water.png` | `landscape-scenes/terrain/` |
| `bark.png` | `flora/trees/` if for trunks; else `landscape-scenes/terrain/` |
| `AnimatedOpening.mp4`, `birdsong.mp3` | `landscape-scenes/cinematic/` and `landscape-scenes/audio/` |
| `VillagePreview_New.png` | `landscape-scenes/presentation/` |
| `Journal.*.png`, `PIP.SacredOnes.png`, `modal.leather.png`, `pwa-icon.png`, `SacredOnes.Avatar.*` | `landscape-scenes/presentation/` (or future `ui/` if you split later) |

## Migration checklist

1. Create the five folders (empty is fine).
2. Move one domain at a time; run `rg 'Assets/` in the repo and update paths + constants.
3. Prefer **symlink or copy** during transition if something is risky; delete old path only when green.

This README is the source of truth for naming until `constants.js` or a small `Assets/manifest.json` is introduced.

## Assets gate (`npm run check:assets`)

`scripts/check-assets.mjs` is the automated gate that backs this README. It is wired into `npm test`, so any failure blocks the full validation run.

What it does:

1. Walks source trees (`js/v2/**`, `index.v2.html`, then legacy + WordPress + SacredOnes.1 + scratch) and extracts every `Assets/...` (or `WORDPRESS/Assets/...`) reference.
2. Verifies each unique path exists on disk.
3. For `.glb` files, verifies the first 4 bytes are the `glTF` magic (`0x67 0x6c 0x54 0x46`).
4. Classifies each existing `Assets/*` path by taxonomy bucket and prints a count of classified vs. unclassified files.

Two tiers:

- **STRICT** — references found in `js/v2/**` or `index.v2.html`. A missing or corrupt asset here exits 1 and fails `npm test`.
- **WARN**   — references found only in legacy / WordPress / SacredOnes.1 / scratch trees. These are reported (with the offending file:line) but do **not** fail the gate. The accepted backlog of WARN-tier debt and the policy for each tree (KEEP / FROZEN / SUNSET) lives in [`../docs/legacy-reconciliation.md`](../docs/legacy-reconciliation.md) — read that before "fixing" any WARN entry by editing legacy code.

Useful flags:

```bash
npm run check:assets              # default: warn-tier informational
node scripts/check-assets.mjs --strict   # promote WARN to FAIL (use for "clean everything" runs)
node scripts/check-assets.mjs --list     # print every unique asset reference (no checks)
node scripts/check-assets.mjs --json     # machine-readable summary on stdout
```

## How to add a new asset

1. Pick the **bucket** from the table above (flora / fauna / npc / buildings / landscape-scenes). When the file lives at root for now, that is fine — just record it under "unclassified" in the gate output.
2. Drop the file under `Assets/<bucket>/<asset-folder>/file.ext` (or at root during the transition window).
3. Reference it from canonical v2 code with a path that is clearly visible in source — the gate's regex looks for `Assets/...` substrings:
   - From `js/v2/**` modules loaded via `GLTFLoader`: use `"./Assets/..."`.
   - From a module that needs `import.meta.url` resolution: use `new URL("../../Assets/...", import.meta.url)`.
4. Run `npm run check:assets` — it must report your new path under STRICT and PASS.
5. If the asset is large or risky, also run the full `npm test` to make sure smoke + check:v2 still pass.
6. Commit the asset and the code reference together; never split them.

## How to remove or rename an asset

1. Find every reference: `npm run check:assets -- --list` then grep, or `rg 'Assets/<old-name>'`.
2. Update or delete the references in the **same** commit as the asset move/delete.
3. Re-run `npm run check:assets`. If the gate fails with a STRICT missing entry, you missed a reference — fix it before commit.

> The gate exists because today (`bush.glb` removal) showed how easy it is to leave a dangling loader after pulling a corrupted asset. This is the cheapest possible CI step that catches that exact regression.

## Migration status (2026-05-16)

### Done — wave 1
| Old path | New path | Notes |
|---|---|---|
| `tipi.bringshappiness copy.obj` | *deleted* | Byte-identical duplicate of `tipi.bringshappiness.obj`, no code refs. ~93 MB freed. |
| `Animated Animal Pack-glb 3/` (folder with spaces) | `fauna/animal-pack/` | All children kebab-cased (`Shiba Inu.glb` → `shiba-inu.glb`, etc.). Zero code refs — pack was orphan. |
| `AxeData.js` | `buildings/props/AxeData.js` | 1.6 MB JS data file, no code refs anywhere. |
| `SacredOnes.Avatar.B.jpg` | `landscape-scenes/presentation/sacred-ones-avatar-b.jpg` | Unreferenced. |
| `modal.leather.png` | `landscape-scenes/presentation/modal-leather.png` | Unreferenced. |
| `VillagePreview_New.png` | `landscape-scenes/presentation/village-preview.png` | Unreferenced. |
| `Tipi.yellowbutterfly/` | *deleted* | Byte-identical to `BACKUP/draco-originals/tipi.yellowbutterfly.WORDPRESS.glb`. The live tipi loaded by `js/v2/**` is `WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb` (Draco-compressed). |
| `grass_seamless.png`, `water.png`, `rock.png`, `bark.png` | `landscape-scenes/terrain/` | Renamed to kebab-case where applicable. |
| `birdsong.mp3` | `landscape-scenes/audio/birdsong.mp3` |  |
| `AnimatedOpening.mp4` | `landscape-scenes/cinematic/animated-opening.mp4` |  |
| `pwa-icon.png`, `Journal.Cover.png`, `Journal.SacredOnes.png`, `JournalHudDpadGuide.png`, `PIP.SacredOnes.png`, `SacredOnes.Avatar.A.png` | `landscape-scenes/presentation/` | Kebab-cased (`Journal.Cover.png` → `journal-cover.png`, etc.). |

**Wave 1 consequence on the gate:** every wave-1 file moved here was WARN-tier (referenced only in legacy code paths — `js/`, `dist/`, `WORDPRESS/`, `_legacy_archive/`, `scratch/`). The STRICT v2 tier (`js/v2/**`, `index.v2.html`) had no references to any of them, so no v2 code edits were needed. The legacy-tier refs now point at missing files and surface in the gate's WARN list — this is accepted debt per [`../docs/legacy-reconciliation.md`](../docs/legacy-reconciliation.md) (legacy trees are FROZEN; refs there are not chased one-by-one).

### Pending — waves 2+

Still at the root of `Assets/`, awaiting future migrations:

- **fauna**: `Bird.glb`, `Buffalo.glb`, `Horse.glb`, `Rabbit.obj`, `rabbit.animated.glb`, `animated.stag.glb`, `animated.yellowbutterfly.glb`, `Fish/`, `animated.deer/`, `animated.rabbit/`, `rabbit_rigged/`, `little_pond__fish/`, `pond1.glb` (the pond GLB itself is more landscape-scenes/water/, the fish folder is fauna)
- **flora**: `tree.glb`, `PineTree/`
- **npc**: `NPC.BHG.glb`, `NPC.REG.glb`, `NPC.YB.glb`, `TraderJosh3d.glb`, `Avatar2.glb`, `Avatar3.glb`, `animated.avatar.glb`, `animated.bringshappiness.glb`
- **buildings**: `tipi.bringshappiness.obj`, `tipi.player.glb`, `axe.glb`
- **misc**: `Journal.Cover.png` was placed in `presentation/`; revisit if a dedicated `ui/` bucket is added later.

Several of these (NPCs, Avatar3, animated.stag, tree, axe, rabbit.animated, Fish/fish.obj, little_pond__fish, pond1, animated.deer) are STRICT-tier (referenced from `js/v2/**`). Migrating them requires updating the v2 code refs in the same commit so the gate stays green.
