/**
 * Sacred Adventures v2 — terrain height and material helpers.
 *
 * Kept separate from WorldModule so terrain math can be reused by physics,
 * tools, and future world chunk/LOD modules without pulling in player state.
 */

import {
  V2_BUILDING_FLATTEN_ANCHORS,
  V2_BUILDING_FLATTEN_EXTRA_RADIUS_M,
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_DEPTH_M,
  V2_POOL2_BASIN_RADIUS_M,
  V2_POOL2_SATELLITE_PONDS,
  V2_RABBIT_WARREN_CHASM_DEPTH_M,
  V2_RABBIT_WARREN_CHASM_RADIUS_M,
  V2_RABBIT_WARREN_HUB_X_M,
  V2_RABBIT_WARREN_HUB_Z_M,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
} from "./constants.js";
import { getActiveMap } from "./MapsConfig.js";

/** Parabolic bowl subtracted at the rabbit-warren triangle centroid (see `Fauna.js`). */
function warrenHubCarveDelta(gx, gz) {
  const dx = gx - V2_RABBIT_WARREN_HUB_X_M;
  const dz = gz - V2_RABBIT_WARREN_HUB_Z_M;
  const r = Math.hypot(dx, dz);
  if (r >= V2_RABBIT_WARREN_CHASM_RADIUS_M) return 0;
  const t = r / V2_RABBIT_WARREN_CHASM_RADIUS_M;
  const bowl = 1 - t * t;
  return V2_RABBIT_WARREN_CHASM_DEPTH_M * bowl;
}

/**
 * Round bowl carved at the POOL2 anchor.
 *
 * May-15 2026 user fix ("tipis should be on flat ground, the valley
 * around the pool and tipis"). The prior bowl extended its outer apron
 * to `R × 1.4` ≈ 38.5 m so a 1.4× bank of mossy mud could show above
 * water. With `V2_POND_ENCLAVE_CENTER` at (10, 26) that apron landed
 * RIGHT ON BOTH TIPIS: tipi 1 sits at dist 27.85 m from the pool centre
 * (carve ≈ 1.7 m), tipi 2 at dist 28.5 m (carve ≈ 1.5 m). The sacred
 * platforms ended up sitting inside a circular moat — clearly visible in
 * the user's screenshot.
 *
 * Constrain the carve to **inside the water rim only** (`r < R`). The
 * quartic profile keeps the deep core (≈ 7.5 m at centre) and tapers to
 * zero exactly at the water disc's edge; outside the rim, the
 * `terrainY` clearing-zone floor stays at `y = 0`, so tipis, dock back,
 * and the surrounding grass are flat. The visible "bank" then comes from
 * the disc's own waterline drop (water Y = −1.6 m) cutting into the
 * carved bowl, not from a sloped apron eating into the village ground.
 */
function pool2BasinCarveDelta(gx, gz) {
  const dx = gx - V2_POND_ENCLAVE_CENTER_X_M;
  const dz = gz - V2_POND_ENCLAVE_CENTER_Z_M;
  const r = Math.hypot(dx, dz);
  const R = V2_POOL2_BASIN_RADIUS_M;
  if (r >= R) return 0;
  const t = r / R;
  const bowl = 1 - t * t;
  return V2_POOL2_BASIN_DEPTH_M * bowl * bowl;
}

/**
 * Satellite pond bowl carves. Replaces the prior stream channel polyline
 * carve (removed May-14 2026 — see `V2_POOL2_SATELLITE_PONDS` docstring
 * for the "streams looked fake / cut off on hills" rationale).
 *
 * Each pond contributes a quartic-falloff bowl (same shape as the main
 * POOL2 basin, scaled down) centred on its anchor. A 1.4× outer ring
 * around the water radius lets the bank blend into the surrounding hex
 * grid without a hard step. Max (not sum) across ponds so overlapping
 * basins don't double-dig.
 *
 * All satellite ponds live inside the central clearing (dist < 30) where
 * `terrainY` is flat, so the bowl carve doesn't fight a hill slope.
 */
function satellitePondsCarveDelta(gx, gz) {
  let best = 0;
  for (let i = 0; i < V2_POOL2_SATELLITE_PONDS.length; i++) {
    const p = V2_POOL2_SATELLITE_PONDS[i];
    const dx = gx - p.x;
    const dz = gz - p.z;
    const r = Math.hypot(dx, dz);
    const outer = p.radius * 1.4;
    if (r >= outer) continue;
    const t = r / outer;
    const bowl = 1 - t * t;
    const carve = p.depth * bowl * bowl;
    if (carve > best) best = carve;
  }
  return best;
}

/**
 * Rabbit-burrow terrain carve REMOVED — May-16 2026 user spec: "get rid
 * of the weird carve out for rabbit holes, or just condense it to width
 * of rabbit hole please". The hex terrain mesh has 1.875 m vertex
 * subdivision and the actual hole opening is `BURROW_THROAT_RAD = 0.14 m`
 * (`Fauna.js`) — a carve scaled to the opening would not register on
 * the mesh at all, and a wider carve created a visible crater that
 * dominated the meadow. The burrow now sits on undisturbed terrain;
 * the dark gradient throat + low rim mound in `Fauna.js` carry the
 * "there's a hole here" read on their own.
 */

// Exact match to AssetFactory.buildGroundChunk terrainY + warren + pond basin.
export function terrainY(gx, gz) {
  /**
   * May-15 2026 user spec: "REdesign map so the tipis are on solid ground
   * not on elevated areas. make the tipis and the pool more on level
   * ground inside this hidden valley."
   *
   * History (legacy): `CLEARING_R = 30`, `HILL_INNER = 30`. Tipi 2 sat at
   * dist 21.7 m from origin and the pool at dist 27.85 m — both inside
   * the clearing radius but in its OUTER noise-blended band where the
   * flatten weight tapered off, so the tipi platform and the pool's bank
   * sat on a wavy 0.6–1.3 m baseNoise hump. The new north-shore dock
   * back at dist ≈ 52 m landed squarely on the hill ring's +3 m hump.
   *
   * Redesign:
   *   • `CLEARING_R` 30 → 55 m — fully encloses tipi 1 (0, 0), tipi 2
   *     (21.7, 0), pool centre (10, 26), north-shore dock back (10, 51),
   *     and player spawn (0, −32.58).
   *   • Everything inside `CLEARING_R` is dead-flat (`y = 0`) — no noise
   *     blend, so every building, platform, and pond bank reads as
   *     anchored to the same level "valley floor".
   *   • `HILL_INNER` 30 → 55 and `HILL_OUTER` 60 → 90 — the surrounding
   *     hill ring is pushed outward so it forms a visible bowl around the
   *     village, selling the "hidden valley" read.
   *   • Pond basin carves still subtract on top of `y = 0` so the pool is
   *     a real 7.5 m bowl in the flat floor (no change there).
   */
  /**
   * Hidden-valley topography (May-2026). Terrain parameters now read
   * from the active map (`MapsConfig.getActiveMap().terrain`) so the
   * Maps registry can swap shape without touching this file.
   *
   * Layered envelope from origin outward (Scene 0 numbers as a guide):
   *   [0, CLEARING_R)            Flat valley floor (y = 0).
   *   [HILL_INNER, HILL_OUTER)   Inner rim — frames the valley.
   *   [MOUNTAIN_INNER, MOUNTAIN_OUTER)
   *                              Outer mountain band, broken into
   *                              summits + saddles for silhouette
   *                              variety.
   *   [MOUNTAIN_OUTER, ∞)        Cliff drop hides the world edge.
   */
  const M = getActiveMap().terrain;
  const CLEARING_R = M.CLEARING_R;
  const HILL_INNER = M.HILL_INNER;
  const HILL_OUTER = M.HILL_OUTER;
  const HILL_HEIGHT = M.HILL_HEIGHT;
  const MOUNTAIN_INNER = M.MOUNTAIN_INNER;
  const MOUNTAIN_OUTER = M.MOUNTAIN_OUTER;
  const MOUNTAIN_HEIGHT = M.MOUNTAIN_HEIGHT;

  let baseNoise =
    Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5 +
    Math.sin(gx * 0.2 + gz * 0.15) * 0.4;
  let y = baseNoise;
  const dist = Math.sqrt(gx * gx + gz * gz);
  const angle = Math.atan2(gz, gx);

  if (dist < CLEARING_R) {
    y = 0;
  }

  /**
   * Two-range topography — redesigned May-17 2026 ("just move hills to
   * edge of that map with two hill ranges, one rolling hills protecting
   * the sacred grove, and a larger one encircling map on 3 sides").
   *
   * Range 1 — INNER ROLLING HILLS: a gentle continuous band just outside
   *   the clearing. Encircles the sacred grove (village + pond) on all
   *   sides. Low amplitude (~6 m peak), smooth multi-octave silhouette.
   *
   * Range 2 — OUTER WALL: a much taller ring at the map edge. Gated by
   *   `wallWeight` so it opens in a ±60° arc due-south (player approach
   *   / view corridor) and rises to full height on the N / E / W rim —
   *   the "3 sides" the user asked for.
   *
   * The `northWeight` term used by the prior pass is GONE — the user
   * specifically asked for the dramatic north spine to be replaced by
   * the two-range layout, so symmetric inner hills + horseshoe outer
   * wall is the correct read.
   */

  // Angular distance from due-south (wraps around 2π). Used to gate the
  // outer wall so a ±60° arc south of origin stays open.
  let dFromSouth = Math.abs(angle - -Math.PI / 2);
  if (dFromSouth > Math.PI) dFromSouth = 2 * Math.PI - dFromSouth;
  const SOUTH_OPENING_HALF_RAD = Math.PI / 3; // ±60° open arc → 120° gap
  const SOUTH_OPENING_BLEND_RAD = 0.45; // soft transition into the wall
  const wallWeight = Math.min(
    1,
    Math.max(0, (dFromSouth - SOUTH_OPENING_HALF_RAD) / SOUTH_OPENING_BLEND_RAD),
  );

  if (dist >= HILL_INNER && dist < HILL_OUTER) {
    // Inner rolling hills — full ring (no gating). Three octaves of
    // sinusoidal variation produce shoulders + saddles instead of a
    // smooth dome.
    const t = (dist - HILL_INNER) / (HILL_OUTER - HILL_INNER);
    const radial = Math.pow(Math.sin(t * Math.PI), 0.92);

    const lowFreq = Math.sin(angle * 1.7 + 0.4);
    const midFreq = Math.sin(angle * 3.2 + 1.8);
    const hiFreq = Math.sin(angle * 7.5 + 2.6);
    const ridge =
      0.55 +
      0.28 * lowFreq +
      0.15 * midFreq +
      0.08 * hiFreq +
      0.05 * lowFreq * midFreq;
    const ridgeClamped = Math.max(0.25, Math.min(1.05, ridge));

    // Modest height — these are PROTECTIVE rolling hills, not a wall.
    // Heads-up: the `HILL_HEIGHT` from the active map is the *peak*; the
    // 0.62 multiplier here keeps the rolling hills well below the outer
    // wall they sit inside of.
    y += HILL_HEIGHT * 0.62 * radial * ridgeClamped;
  }

  if (dist >= MOUNTAIN_INNER && dist < MOUNTAIN_OUTER) {
    // Outer wall — only on the N / E / W rim (3 sides). The ±60° arc
    // due-south stays flat so the player can see out / walk out.
    if (wallWeight > 0.001) {
      const t = (dist - MOUNTAIN_INNER) / (MOUNTAIN_OUTER - MOUNTAIN_INNER);
      const wallShape = Math.sin(t * Math.PI);
      const summit = 0.65 + 0.35 * Math.sin(angle * 4.1 + 0.7);
      const saddle = 0.78 + 0.22 * Math.cos(angle * 2.3 - 1.4);
      const peakNoise = 0.88 + 0.12 * Math.sin(angle * 11 + gx * 0.07);
      y += MOUNTAIN_HEIGHT * wallShape * summit * saddle * peakNoise * wallWeight;
    }
  }

  // Soft rolling-hill blend in the band between hill and mountain to
  // smooth their join. Replaces the prior `dist > HILL_OUTER` rolling
  // pass which only added gentle waves with no real elevation.
  if (dist > HILL_OUTER && dist < MOUNTAIN_INNER + 5) {
    const outerBlend = Math.min(1.0, (dist - HILL_OUTER) / 6);
    const rollingH =
      Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.0 +
      Math.sin(gx * 0.12 + gz * 0.1) * 0.8;
    y += rollingH * outerBlend;
  }

  if (dist > MOUNTAIN_OUTER) {
    // World-edge cliff drop — the terrain mesh ends ~2 m past this,
    // and the drop reads as "the mountains fall away" rather than a
    // visible edge. Bumped harder than before (cubic to 16 m) so the
    // tall mountain ridges don't dangle above the void.
    const dropT = Math.min(1.0, (dist - MOUNTAIN_OUTER) / 8.0);
    y = y * (1.0 - dropT) - Math.pow(dropT, 3.0) * 16.0;
  }

  y -= warrenHubCarveDelta(gx, gz);
  y -= pool2BasinCarveDelta(gx, gz);
  y -= satellitePondsCarveDelta(gx, gz);

  /**
   * Village building pads (tipi 1 / tipi 2): user spec — extra level ground around
   * each structure. After analytic carves, clamp back to the hidden-valley floor so
   * decks and GLB soles align with flat earth instead of sitting in rabbit bowls /
   * satellite-pond rings.
   */
  const flatR = V2_TIPI_SACRED_PLATFORM_RADIUS + V2_BUILDING_FLATTEN_EXTRA_RADIUS_M;
  const flatR2 = flatR * flatR;
  for (let fi = 0; fi < V2_BUILDING_FLATTEN_ANCHORS.length; fi++) {
    const fa = V2_BUILDING_FLATTEN_ANCHORS[fi];
    const fdx = gx - fa.x;
    const fdz = gz - fa.z;
    if (fdx * fdx + fdz * fdz < flatR2) {
      y = Math.max(y, 0);
      break;
    }
  }

  return y;
}

// Neumorphic hex shader ported from AssetFactory onBeforeCompile.
export function applyNeuHexShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vWorldPos;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
       vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
       varying vec3 vWorldPos;
       float hexDist(vec2 p) {
         p = abs(p);
         float c = dot(p, normalize(vec2(1.0, 1.73205081)));
         return max(c, p.x);
       }`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       // Hidden-valley refactor (May-2026 user rating 27/100): the prior
       // seam contrast (0.25× darken at the edge, 0.55× corner dip)
       // turned every hex boundary into a black trough — the dominant
       // ugly read in any screenshot. Softened the crack-darkening to
       // 0.78× max and the corner dip to 0.20× max so the hex texture
       // becomes a subtle grain rather than a hard tile grid.
       float hexRadius = 6.27;
       float hr3 = hexRadius * 1.73205081;
       vec2 r = vec2(hr3, hexRadius * 3.0);
       vec2 h = r * 0.5;
       vec2 uv = vWorldPos.xz;
       vec2 a = mod(uv, r) - h;
       vec2 b = mod(uv - h, r) - h;
       vec2 localPos = dot(a,a) < dot(b,b) ? a : b;
       float dist2 = hexDist(localPos);
       float maxDist = hr3 * 0.5;
       float edgeDist = maxDist - dist2;

       if (edgeDist < 0.21) {
         float crack = smoothstep(0.0, 0.21, edgeDist);
         diffuseColor.rgb *= (0.78 + crack * crack * 0.18);
       }
       else if (edgeDist < 0.4875) {
         float slope = smoothstep(0.21, 0.4875, edgeDist);
         diffuseColor.rgb *= (slope * 0.10 + 0.92);
       }
       else if (edgeDist < 0.7125) {
         float rim = smoothstep(0.4875, 0.7125, edgeDist);
         diffuseColor.rgb *= (1.0 + (1.0 - rim) * 0.06);
       }
       else {
         diffuseColor.rgb *= 1.02;
       }
       float cornerDist = length(localPos);
       if (cornerDist > hexRadius * 0.65) {
         float cornerDip = smoothstep(hexRadius * 0.65, hexRadius, cornerDist);
         diffuseColor.rgb *= (1.0 - cornerDip * 0.20);
       }`,
    );
  };
}
