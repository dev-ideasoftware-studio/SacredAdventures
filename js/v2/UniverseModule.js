/**
 * Legacy path — Anu (`AnuModule.js`) is the sole SacredOrchestrator coordinator.
 *
 * - Prefer `import { AnuModule } from "./AnuModule.js"` and `orc.register(AnuModule)`.
 * - `UniverseModule` is an alias of `AnuModule` (registry name remains `"Anu"`).
 *   Do not register both.
 */
export {
  AnuModule,
  AnuModule as UniverseModule,
  ANU_PIPELINE_MEMORY,
} from "./AnuModule.js";
