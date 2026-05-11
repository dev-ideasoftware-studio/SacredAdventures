import * as THREE from "three";

/**
 * Horizontal travel decals (CircleGeometry / RingGeometry with rotation.x = −π/2).
 * Uses vertex radial distance — correct for Three.js ring UV layout.
 * depthTest off so rings stay visible over uneven terrain / nearby meshes (decal-style read).
 */
export function createPhotorealTravelDiscMaterial(kind, outerRadius) {
  const isNpc = kind === "npc";
  const uTime = { value: 0 };
  const uOuter = { value: outerRadius };
  const inner = isNpc
    ? new THREE.Color(0x6b5218)
    : new THREE.Color(0x0d260d);
  const mid = isNpc ? new THREE.Color(0xc9a227) : new THREE.Color(0x2e7d32);
  const rim = isNpc ? new THREE.Color(0xfff2b8) : new THREE.Color(0x7cb342);
  const uInner = { value: inner };
  const uMid = { value: mid };
  const uRim = { value: rim };
  const uSpec = { value: isNpc ? 0.55 : 0.22 };
  const uGrain = { value: isNpc ? 0.14 : 0.09 };

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
varying float vRn;
varying vec2 vHashUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float r = vRn;
  if (r > 1.001) discard;
  float edge = smoothstep(0.98, 0.72, r);
  float core = smoothstep(0.95, 0.0, r);
  vec3 base = mix(uInner, uMid, pow(r, 0.85));
  base = mix(base, uRim, edge * edge * 0.85);
  vec2 gn = vHashUv * 96.0 + uTime * 0.08;
  float grain = (hash(gn) - 0.5) * uGrain;
  base += grain;
  float glint = pow(1.0 - clamp(r, 0.0, 1.0), 4.0) * uSpec * 0.42;
  base += glint * mix(0.35, 1.0, edge);
  float ao = mix(1.0, 0.82, smoothstep(0.2, 1.0, r));
  base *= ao;
  float a = mix(0.34, 0.42, edge) * (0.88 + 0.12 * core);
  gl_FragColor = vec4(base, a);
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
    },
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createPhotorealTravelRingMaterial(
  kind,
  innerRadius,
  outerRadius,
) {
  const isNpc = kind === "npc";
  const uTime = { value: 0 };
  const uInnerR = { value: innerRadius };
  const uOuterR = { value: outerRadius };
  const uInner = { value: new THREE.Color(isNpc ? 0xa67c00 : 0xffffff) };
  const uOuter = { value: new THREE.Color(isNpc ? 0xfff8dc : 0xffffff) };
  const uMetal = { value: isNpc ? 0.62 : 0.08 };

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
  gl_FragColor = vec4(col, 0.94);
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
    },
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function touchTravelCircleTime(material, nowSec) {
  if (!material?.uniforms?.uTime) return;
  material.uniforms.uTime.value = nowSec;
}
