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
