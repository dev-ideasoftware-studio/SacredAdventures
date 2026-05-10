/**
 * Sacred Adventures v2 — terrain height and material helpers.
 *
 * Kept separate from WorldModule so terrain math can be reused by physics,
 * tools, and future world chunk/LOD modules without pulling in player state.
 */

// Exact match to AssetFactory.buildGroundChunk terrainY.
export function terrainY(gx, gz) {
  const CLEARING_R = 30;
  const HILL_INNER = 30;
  const HILL_OUTER = 60;
  const HILL_HEIGHT = 4.0;

  let baseNoise =
    Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5 +
    Math.sin(gx * 0.2 + gz * 0.15) * 0.4;
  let y = baseNoise;
  const dist = Math.sqrt(gx * gx + gz * gz);

  if (dist < CLEARING_R) {
    if (dist < 8) {
      y = 0;
    } else {
      const t = (dist - 8) / (CLEARING_R - 8);
      const flatten = 0.5 + 0.5 * Math.cos(t * Math.PI);
      y = baseNoise * (1.0 - flatten);
    }
  }

  if (dist >= HILL_INNER && dist < HILL_OUTER) {
    const t = (dist - HILL_INNER) / (HILL_OUTER - HILL_INNER);
    const hillShape = Math.sin(t * Math.PI);
    const angle = Math.atan2(gz, gx);
    const noise =
      0.65 + 0.35 * Math.sin(angle * 3 + 0.8) * Math.sin(angle * 5 + 2.1) * 0.3;
    const lobe = 0.7 + 0.3 * Math.sin(angle * 2.3 + 1.2);
    y += HILL_HEIGHT * hillShape * (noise + 0.5) * lobe;
  }

  if (dist > HILL_OUTER) {
    const outerBlend = Math.min(1.0, (dist - HILL_OUTER) / 10);
    const rollingH =
      Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.5 +
      Math.sin(gx * 0.12 + gz * 0.1) * 1.0;
    y += rollingH * outerBlend;
  }

  if (dist > 100) {
    const dropT = Math.min(1.0, (dist - 100) / 20.0);
    y = y * (1.0 - dropT) - Math.pow(dropT, 3.0) * 8.0;
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
         diffuseColor.rgb *= (0.25 + crack * crack * 0.525);
       }
       else if (edgeDist < 0.4875) {
         float slope = smoothstep(0.21, 0.4875, edgeDist);
         diffuseColor.rgb *= (slope * 0.3375 + 0.5125);
       }
       else if (edgeDist < 0.7125) {
         float rim = smoothstep(0.4875, 0.7125, edgeDist);
         diffuseColor.rgb *= (1.0 + (1.0 - rim) * 0.165);
       }
       else {
         diffuseColor.rgb *= 1.04;
       }
       float cornerDist = length(localPos);
       if (cornerDist > hexRadius * 0.65) {
         float cornerDip = smoothstep(hexRadius * 0.65, hexRadius, cornerDist);
         diffuseColor.rgb *= (1.0 - cornerDip * 0.55);
       }`,
    );
  };
}
