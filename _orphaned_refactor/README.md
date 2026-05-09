# Orphaned Refactor — DO NOT USE

These files are from an abandoned ES module rewrite of the engine.
They are NOT loaded by index.html and have zero live references.

Quarantined on 05-09-2026 by Cas during codebase audit.

## What's here
- `core/` — EventBus, RenderPipeline, EntitySystem architecture (never activated)
- `components/` — HexGridManager, JournalInterface, PlayerManager, ResourceManager, WorldManager stubs

## Why kept (not deleted)
- `components/WorldManager.js` and `ResourceManager.js` may contain salvageable logic
- Safe reference if we ever start a proper module refactor

## Safe to delete permanently if confirmed unused after full pillar audit.
