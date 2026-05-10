/**
 * Synodic lunar phase index (8 buckets) shared by PiP moondial + main-view night sky moon.
 */

const LUNAR_MONTH = 29.53058867;
const NEW_MOON_EPOCH_MS = new Date("2000-01-06T18:14:00Z").getTime();

/**
 * @param {Date} [date]
 * @param {number | null | undefined} manualIndex 0–7 from PiP dial; astronomical if nullish
 * @returns {number} phase bucket 0..7 (0 new, 4 full — matches PiP emoji order)
 */
export function lunarPhaseSynodicIndex(date = new Date(), manualIndex = null) {
  if (manualIndex != null) return manualIndex & 7;

  const diff = date.getTime() - NEW_MOON_EPOCH_MS;
  const days = diff / (1000 * 60 * 60 * 24);
  const frac =
    (((days % LUNAR_MONTH) + LUNAR_MONTH) % LUNAR_MONTH) / LUNAR_MONTH;
  return Math.floor(frac * 8) % 8;
}
