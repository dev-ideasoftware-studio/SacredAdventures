/**
 * Anu — central interaction dispatch (UI, physics-adjacent events, orchestration).
 * Event name constants: ./anuEvents.js (import ANU_EVENTS from there).
 */

const _subs = new Map(); // event -> Set<handler>

function _ensure(key) {
  if (!_subs.has(key)) _subs.set(key, new Set());
  return _subs.get(key);
}

/**
 * @param {string} event - use ANU_EVENTS.*
 * @param {(detail: unknown) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeInteraction(event, handler) {
  if (typeof handler !== "function") return () => {};
  const set = _ensure(event);
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) _subs.delete(event);
  };
}

/**
 * @param {string} event
 * @param {unknown} [detail]
 */
export function dispatchInteraction(event, detail) {
  const set = _subs.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (e) {
      console.warn(`[Anu/interaction] ${event}:`, e);
    }
  }
}
