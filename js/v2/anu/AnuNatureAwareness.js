/**
 * Sacred Adventures v2 — Anu Nature Awareness service.
 *
 * Goal (May-16 2026 user spec: "communicate with ANU how it will control
 * the AI of each animal as if it were aware of each other and the
 * player"). A small registry that lets every animal in the world know:
 *
 *   1. WHERE the player is right now (cached from `WorldPhysics._bodies[0]`
 *      on every `tick()`).
 *   2. WHERE the other animals are, by kind (deer, rabbit, fish, ...).
 *   3. Whether a panic ALARM has recently been raised, and at what XZ.
 *
 * Behaviour modules call:
 *   • `register({ id, kind, x, z, panicRadius, alertRadius })` once.
 *   • `update(id, x, z)` per frame (or whenever the animal moves).
 *   • `unregister(id)` on dispose.
 *   • `senseThreat(x, z, kind)` to learn how close the nearest threat
 *     (player + active alarm + larger predators) is. Returns
 *     `{ kind, dx, dz, dist }` or `null` if nothing is close enough to
 *     matter.
 *   • `raiseAlarm(x, z, kind, reason)` when a creature flees — broadcasts
 *     the panic position so nearby animals can react.
 *
 * The service is intentionally tiny + synchronous; it never sleeps and
 * never owns its own RAF. The orchestrator's main loop pumps it via
 * `tick()` once per frame so the player-position cache stays fresh.
 *
 * Exposes itself via `RuntimeServices` so any module can grab it via
 * `getRuntimeService("AnuNatureAwareness")`. Also publishes an
 * `ANU_EVENTS.FAUNA_TICK` snapshot when the alarm flag flips, which lets
 * upstream sensoria (`AnuWorldSensorium`) include nature awareness in
 * their AI-readable JSON without polling.
 */
import { registerRuntimeService, getRuntimeService } from "../RuntimeServices.js";
import { dispatchInteraction } from "./InteractionBus.js";
import { ANU_EVENTS } from "./anuEvents.js";

/**
 * One frame's snapshot of a registered animal.
 * @typedef {{
 *   id: string,
 *   kind: "deer" | "rabbit" | "fish" | "bird" | "fauna" | string,
 *   x: number,
 *   z: number,
 *   panicRadius: number,
 *   alertRadius: number,
 *   updatedAt: number,
 * }} AwarenessEntry
 */

/**
 * @typedef {{
 *   x: number,
 *   z: number,
 *   kind: string,
 *   reason: string,
 *   raisedAt: number,
 * }} Alarm
 */

const _state = {
  /** @type {Map<string, AwarenessEntry>} */
  entries: new Map(),
  /** Cached player XZ from `WorldPhysics._bodies[0]`. `null` until first tick. */
  playerX: null,
  playerZ: null,
  /** Most-recent alarm; clears after `ALARM_TTL_MS`. */
  alarm: /** @type {Alarm | null} */ (null),
  /** Performance.now() at last tick (used for alarm TTL + entry staleness). */
  lastTickMs: 0,
};

/** Alarms last this long after being raised. 4 s of panic propagation. */
const ALARM_TTL_MS = 4000;
/** Entries that haven't called `update()` in this long are stale and ignored. */
const ENTRY_TTL_MS = 2000;

/** Cheap re-used Math.hypot to avoid allocations in the hot path. */
function _dist(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

const AnuNatureAwareness = {
  /**
   * Register an animal once. `panicRadius` is the distance at which the
   * caller-side FSM should switch to FLEE; `alertRadius` is the larger
   * "I notice you" distance.
   *
   * @param {{ id: string, kind: string, x: number, z: number, panicRadius?: number, alertRadius?: number }} spec
   */
  register(spec) {
    if (!spec?.id) return null;
    const entry = {
      id: spec.id,
      kind: spec.kind || "fauna",
      x: spec.x,
      z: spec.z,
      panicRadius: spec.panicRadius ?? 4.0,
      alertRadius: spec.alertRadius ?? 9.0,
      updatedAt: typeof performance !== "undefined" ? performance.now() : 0,
    };
    _state.entries.set(spec.id, entry);
    return entry;
  },

  /** Mark an entry stale + drop it. */
  unregister(id) {
    _state.entries.delete(id);
  },

  /** Per-frame position update — called by each animal's update routine. */
  update(id, x, z) {
    const e = _state.entries.get(id);
    if (!e) return;
    e.x = x;
    e.z = z;
    e.updatedAt = typeof performance !== "undefined" ? performance.now() : 0;
  },

  /**
   * Sense the closest threat to a position. Threats are, in priority order:
   *   1. The player, if within `alertRadius` (caller's value).
   *   2. The active alarm position, if within ~12 m.
   *   3. The closest larger animal (e.g. deer is a threat to rabbit), if
   *      within `alertRadius` and of a different `kind`.
   *
   * Returns `null` if nothing's close enough to matter so the caller can
   * short-circuit fast.
   *
   * @param {number} x
   * @param {number} z
   * @param {string} kind  — the QUERYING animal's kind (used to filter self).
   * @returns {{ kind: string, dx: number, dz: number, dist: number, severity: number } | null}
   */
  senseThreat(x, z, kind) {
    let best = null;
    // 1) Player. Cached from WorldPhysics each tick.
    if (_state.playerX !== null && _state.playerZ !== null) {
      const dist = _dist(_state.playerX, _state.playerZ, x, z);
      if (dist < 14.0) {
        best = {
          kind: "player",
          dx: x - _state.playerX,
          dz: z - _state.playerZ,
          dist,
          severity: dist < 4.0 ? 1.0 : dist < 8.0 ? 0.6 : 0.2,
        };
      }
    }
    // 2) Active alarm.
    const a = _state.alarm;
    if (a) {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (now - a.raisedAt > ALARM_TTL_MS) {
        _state.alarm = null;
      } else {
        const dist = _dist(a.x, a.z, x, z);
        if (dist < 12.0) {
          const sev = (1 - dist / 12.0) * 0.7;
          if (!best || sev > best.severity) {
            best = {
              kind: `alarm:${a.kind}`,
              dx: x - a.x,
              dz: z - a.z,
              dist,
              severity: sev,
            };
          }
        }
      }
    }
    // 3) Other animals — only "larger" relations matter (deer scares
    //    rabbits, but a rabbit doesn't scare a deer). Map is the
    //    dominance order; an animal is afraid of EVERY animal whose
    //    kind appears AFTER its own kind in this list.
    const FEAR_ORDER = ["bird", "fish", "rabbit", "deer", "player"];
    const myRank = FEAR_ORDER.indexOf(kind);
    if (myRank >= 0) {
      const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
      for (const e of _state.entries.values()) {
        if (e.id === undefined || e.kind === kind) continue;
        const otherRank = FEAR_ORDER.indexOf(e.kind);
        if (otherRank <= myRank) continue;
        if (nowMs - e.updatedAt > ENTRY_TTL_MS) continue;
        const dist = _dist(e.x, e.z, x, z);
        if (dist < 9.0) {
          const sev = (1 - dist / 9.0) * 0.4;
          if (!best || sev > best.severity) {
            best = {
              kind: e.kind,
              dx: x - e.x,
              dz: z - e.z,
              dist,
              severity: sev,
            };
          }
        }
      }
    }
    return best;
  },

  /**
   * Broadcast a panic event. Animals within ~12 m will pick it up via
   * `senseThreat()` for the next `ALARM_TTL_MS`.
   */
  raiseAlarm(x, z, kind, reason) {
    _state.alarm = {
      x,
      z,
      kind: kind || "fauna",
      reason: reason || "spooked",
      raisedAt: typeof performance !== "undefined" ? performance.now() : 0,
    };
    dispatchInteraction(ANU_EVENTS.FAUNA_TICK, {
      kind: "alarm",
      x,
      z,
      animal: kind,
      reason,
    });
  },

  /**
   * Pumped once per frame by the orchestrator. Refreshes the player XZ
   * cache from `WorldPhysics._bodies[0]` (the live physics body) so
   * `senseThreat()` answers are within a frame of reality.
   */
  tick() {
    _state.lastTickMs =
      typeof performance !== "undefined" ? performance.now() : 0;
    const physics =
      getRuntimeService("WorldPhysics") ??
      (typeof window !== "undefined" ? window.WorldPhysics : null);
    const body = physics?._bodies?.[0];
    if (body?.position) {
      _state.playerX = body.position.x;
      _state.playerZ = body.position.z;
    }
  },

  /**
   * AI-readable snapshot — included in `AnuWorldSensorium` exports so the
   * journal / governance can reason about nature state without polling
   * the registry directly.
   */
  snapshot() {
    return {
      animalCount: _state.entries.size,
      kinds: [..._state.entries.values()].reduce((m, e) => {
        m[e.kind] = (m[e.kind] || 0) + 1;
        return m;
      }, {}),
      playerXZ:
        _state.playerX !== null
          ? { x: _state.playerX, z: _state.playerZ }
          : null,
      alarm: _state.alarm
        ? {
            x: _state.alarm.x,
            z: _state.alarm.z,
            kind: _state.alarm.kind,
            ageMs:
              (typeof performance !== "undefined"
                ? performance.now()
                : 0) - _state.alarm.raisedAt,
          }
        : null,
    };
  },
};

registerRuntimeService("AnuNatureAwareness", AnuNatureAwareness, {
  owner: "anu",
});

export { AnuNatureAwareness };
