export const AUTOWALK_HOLD_MS = 3000;

export function syncAutowalkFromHeldKeys(world, now, dir) {
  const keys = ["w", "arrowup", "a", "s", "arrowdown", "d"];
  const heldLongEnough = keys.some((key) => {
    const downAt = world._keyDownAt[key];
    return world._keys[key] && downAt && now - downAt >= AUTOWALK_HOLD_MS;
  });
  if (!heldLongEnough || dir.lengthSq() === 0) return;
  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
  world._autoWalk.active = true;
  world._autoWalk.key = "held-move";
  world._autoWalk.startedByHoldAt = now;
  world._autoWalk.dirX = dir.x / len;
  world._autoWalk.dirZ = dir.z / len;
}

export function buildWorldPlayerState(world, camera, body) {
  const velocityXZMps = Math.sqrt(
    body.velocity.x * body.velocity.x + body.velocity.z * body.velocity.z,
  );
  return {
    feet: world._feetScratch,
    position: camera.position,
    avatar: world._avatar?.root ?? null,
    /** Same object as `World` uses for locomotion + gestures (HUD mirror, tooling). */
    avatarController: world._avatar ?? null,
    animations: world._avatar?.clips ?? [],
    animationMap: world._avatar?.semanticClips ?? null,
    /** Horizontal speed (m/s) for HUD affordances (e.g. auto-expand resource ring when idle). */
    velocityXZMps,
    autowalk: { ...world._autoWalk },
    yaw: world._yaw,
    grounded: body.grounded,
    distanceMeters: world._walkDistance,
    distanceFeet: world._walkDistance * 3.28084,
    /** When true, main canvas uses top-down map camera; PiP shows forward/scenic view. */
    mainCanvasMapView: world._mainCanvasMapView === true,
    toggleMainCanvasMapView: () => {
      world._mainCanvasMapView = !world._mainCanvasMapView;
      world._cameraSmoothReady = false;
      return world._mainCanvasMapView;
    },
    /** Live read of the keys held this frame — used by WorldFishingModule to
     *  consume the spacebar without colliding with the jump handler in
     *  `World.update`. Returns false if the input pipe isn't initialized. */
    isKeyDown: (k) => !!world._keys?.[typeof k === "string" ? k.toLowerCase() : ""],
    /** Snap the avatar yaw — used by WorldFishingModule to face the player
     *  toward the hook when the fishing camera engages. */
    setYaw: (y) => { if (Number.isFinite(y)) world._yaw = y; },
  };
}

export function wirePlayerInput(world, dispatchInteraction, ANU_EVENTS) {
  world._keys = {};
  world._keyDownAt = {};
  world._onKey = (e) => {
    // Suspend movement input while a modal overlay (e.g. journal) is open.
    // The journal toggler sets window._v2InputSuppressed = true on open and
    // resets it on close. We also force-clear all in-flight key state so the
    // player doesn't drift when the modal opens mid-stride.
    if (window._v2InputSuppressed) {
      if (Object.keys(world._keys).length || Object.keys(world._keyDownAt).length) {
        world._keys = {};
        world._keyDownAt = {};
        world._autoWalk.active = false;
        world._autoWalk.key = null;
      }
      return;
    }
    const down = e.type === "keydown";
    const raw = e.key;
    const key = typeof raw === "string" ? raw.toLowerCase() : "";
    const wasDown = !!world._keys[key];
    world._keys[key] = down;
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (down && !wasDown) {
      world._keyDownAt[key] = now;
    } else if (!down) {
      delete world._keyDownAt[key];
    }
    if (down && !wasDown && ["w", "a", "s", "d", "arrowup", "arrowdown"].includes(key)) {
      world._autoWalk.active = false;
    }
    if (down && key === " ") {
      world._autoWalk.active = false;
    }
    if (
      [
        "w",
        "a",
        "s",
        "d",
        " ",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
      ].includes(key)
    ) {
      dispatchInteraction(ANU_EVENTS.PLAYER_KEY_EDGE, {
        key,
        down,
        code: e.code,
        t: now,
      });
    }
  };
  window.addEventListener("keydown", world._onKey);
  window.addEventListener("keyup", world._onKey);
}

export function clearPlayerInput(world) {
  if (world._onKey) {
    window.removeEventListener("keydown", world._onKey);
    window.removeEventListener("keyup", world._onKey);
  }
  world._onKey = null;
  world._keys = {};
  world._keyDownAt = {};
}
