import * as THREE from "three";

/**
 * Horizontal travel decals (CircleGeometry / RingGeometry with rotation.x = −π/2).
 * Uses vertex radial distance — correct for Three.js ring UV layout.
 * **`transparent: false`** so these draw in the opaque pass: fully transparent
 * queue would always paint *after* the opaque player mesh, which made the
 * selection disc read on top of the figurine (May-14 2026 user report).
 * `depthTest` stays on (see `WorldAvatar`); `depthWrite: false` avoids
 * carving bad depth into the buffer on slopes.
 */
export function createPhotorealTravelDiscMaterial(kind, outerRadius) {
  // NPC kind: natural wood-timber palette (May-13 2026 user pass — was gold).
  // Aged oak shadow → cinnamon walnut → warm blonde pine highlight, with the
  // metallic sheen (uSpec) dropped from 0.55 → 0.18 so it reads as matte
  // timber, not foil. Grain bumped 0.14 → 0.20 so the fragment-shader noise
  // reads as wood grain rather than a flat tint.
  // Fishing kind: soft blue gradient that perfectly matches player's circle during fishing.
  const isNpc = kind === "npc";
  const isFishing = kind === "fishing";
  const uTime = { value: 0 };
  const uOuter = { value: outerRadius };
  
  const inner = new THREE.Color(0x0d260d);
  const mid = new THREE.Color(0x2e7d32);
  const rim = new THREE.Color(0x7cb342);
  
  if (isNpc) {
    inner.setHex(0x3a2412); // aged oak shadow
    mid.setHex(0x8b5a2b);   // walnut / cinnamon
    rim.setHex(0xd4a574);   // blonde pine highlight
  } else if (isFishing) {
    inner.setHex(0x0a243a); // deep baby blue shadow
    mid.setHex(0x4fc3f7);   // vibrant baby blue mid-tone
    rim.setHex(0xb3e5fc);   // soft pale baby blue rim
  }
  
  const uInner = { value: inner };
  const uMid = { value: mid };
  const uRim = { value: rim };
  const uSpec = { value: isNpc ? 0.18 : 0.22 };
  const uGrain = { value: isNpc ? 0.20 : 0.09 };
  const uOpacity = { value: 1.0 };

  const vs = `
uniform float uOuter;
varying float vRn;
varying vec2 vHashUv;
void main() {
  vRn = length(position.xy) / max(uOuter, 1e-4);
  vHashUv = position.xy * 3.1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

  const fs = `
uniform vec3 uInner;
uniform vec3 uMid;
uniform vec3 uRim;
uniform float uSpec;
uniform float uGrain;
uniform float uTime;
uniform float uOpacity;
varying float vRn;
varying vec2 vHashUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float r = vRn;
  if (r > 1.001) discard;
  float edge = smoothstep(0.98, 0.72, r);
  vec3 base = mix(uInner, uMid, pow(r, 0.85));
  base = mix(base, uRim, edge * edge * 0.85);
  vec2 gn = vHashUv * 96.0 + uTime * 0.08;
  float grain = (hash(gn) - 0.5) * uGrain;
  base += grain;
  float glint = pow(1.0 - clamp(r, 0.0, 1.0), 4.0) * uSpec * 0.42;
  base += glint * mix(0.35, 1.0, edge);
  float ao = mix(1.0, 0.82, smoothstep(0.2, 1.0, r));
  base *= ao;
  gl_FragColor = vec4(base, uOpacity);
}
`;

  return new THREE.ShaderMaterial({
    uniforms: {
      uOuter,
      uInner,
      uMid,
      uRim,
      uSpec,
      uGrain,
      uTime,
      uOpacity,
    },
    vertexShader: vs,
    fragmentShader: fs,
    transparent: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createPhotorealTravelRingMaterial(
  kind,
  innerRadius,
  outerRadius,
) {
  // NPC kind: natural wood-timber rim (May-13 2026 user pass — was gold).
  // Walnut inner → blonde pine outer with the metallic sheen (uMetal) dropped
  // from 0.62 → 0.10 so the rim reads as a soft carved-timber border, not a
  // gilded ring.
  // Fishing kind: soft blue gradient rim outline.
  const isNpc = kind === "npc";
  const isFishing = kind === "fishing";
  const uTime = { value: 0 };
  const uInnerR = { value: innerRadius };
  const uOuterR = { value: outerRadius };
  
  const inner = new THREE.Color(0xffffff);
  const outer = new THREE.Color(0xffffff);
  
  if (isNpc) {
    inner.setHex(0x6b3e1f);
    outer.setHex(0xd4a574);
  } else if (isFishing) {
    inner.setHex(0xb3e5fc);
    outer.setHex(0x0288d1);
  }

  const uInner = { value: inner };
  const uOuter = { value: outer };
  const uMetal = { value: isNpc ? 0.10 : 0.08 };
  const uOpacity = { value: 1.0 };

  const vs = `
uniform float uInnerR;
uniform float uOuterR;
varying float vT;
varying vec2 vHp;
void main() {
  float rad = length(position.xy);
  vT = (rad - uInnerR) / max(uOuterR - uInnerR, 1e-4);
  vHp = position.xy * 2.7;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

  const fs = `
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uMetal;
uniform float uTime;
uniform float uOpacity;
varying float vT;
varying vec2 vHp;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  if (vT < -0.02 || vT > 1.02) discard;
  vec3 col = mix(uInner, uOuter, clamp(vT, 0.0, 1.0));
  float sc = hash(vHp * 31.0 + uTime * 0.05);
  col += (sc - 0.5) * 0.04 * (1.0 + uMetal * 2.0);
  float glint = pow(max(0.0, vT), 5.0) * uMetal * 0.45;
  col += glint;
  gl_FragColor = vec4(col, uOpacity);
}
`;

  return new THREE.ShaderMaterial({
    uniforms: {
      uInnerR,
      uOuterR,
      uInner,
      uOuter,
      uMetal,
      uTime,
      uOpacity,
    },
    vertexShader: vs,
    fragmentShader: fs,
    transparent: false,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function touchTravelCircleTime(material, nowSec) {
  if (!material?.uniforms?.uTime) return;
  material.uniforms.uTime.value = nowSec;
}
