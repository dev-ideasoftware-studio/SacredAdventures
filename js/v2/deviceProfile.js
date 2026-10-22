/**
 * Device profile: the single answer to "is this a phone or tablet?".
 *
 * Every live module that branches on mobile imports `deviceProfile` from here
 * instead of testing the user agent itself.
 *
 * Detection is the exact rule the four former copies used (Orchestrator x2,
 * AnuAdaptiveDpr, gltfLoaderSetup):
 *   - UA matches /Mobi|Android|iPhone|iPod/i, or /iPad/i, or
 *   - UA says "Macintosh" and the device has more than one touch point
 *     (iPadOS Safari reports a desktop Mac UA).
 *
 * Testing override: add `?device=mobile` or `?device=desktop` to the page URL.
 * The override only changes what this module reports. The browser's real UA,
 * touch support and pixel ratio stay the same.
 */

function readUserAgent() {
  return (typeof navigator !== "undefined" && navigator.userAgent) || "";
}

function readTouchPoints() {
  return (typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0;
}

function readOverride() {
  try {
    if (typeof location === "undefined") return null;
    const v = new URLSearchParams(location.search).get("device");
    return v === "mobile" || v === "desktop" ? v : null;
  } catch (_) {
    return null;
  }
}

/** Pure detection, exported so tests can feed it any UA / touch-point count. */
export function detectMobile(ua, maxTouchPoints) {
  return (
    /Mobi|Android|iPhone|iPod/i.test(ua) ||
    /iPad/i.test(ua) ||
    (/Macintosh/.test(ua) && (maxTouchPoints || 0) > 1)
  );
}

function buildProfile() {
  const ua = readUserAgent();
  const touchPoints = readTouchPoints();
  const override = readOverride();
  const detected = detectMobile(ua, touchPoints);
  const isMobile = override ? override === "mobile" : detected;
  return Object.freeze({
    isMobile,
    /** iPadOS Safari presenting a desktop Mac UA. */
    isIPadOS: /Macintosh/.test(ua) && touchPoints > 1,
    isTouch: touchPoints > 0,
    /** Device-pixel-ratio ceiling used by the renderer and AnuAdaptiveDpr. */
    dprCap: isMobile ? 1.0 : 1.5,
    /** "ua" when detected, "query" when ?device= forced it. */
    source: override ? "query" : "ua",
  });
}

export const deviceProfile = buildProfile();

if (typeof window !== "undefined") {
  // Read-only handle for DevTools and test probes.
  try {
    Object.defineProperty(window, "SacredDeviceProfile", {
      value: deviceProfile,
      configurable: true,
    });
  } catch (_) {
    /* non-fatal */
  }
}
