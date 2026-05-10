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
  return {
    feet: world._feetScratch,
    position: camera.position,
    avatar: world._avatar?.root ?? null,
    animations: world._avatar?.clips ?? [],
    animationMap: world._avatar?.semanticClips ?? null,
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
  };
}

export function wirePlayerInput(world, dispatchInteraction, ANU_EVENTS) {
  world._keys = {};
  world._keyDownAt = {};
  world._onKey = (e) => {
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
