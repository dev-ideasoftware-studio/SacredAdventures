/**
 * Sacred Adventures — sanctuary part 22 of N: VILLAGE BUILD PAD.
 *
 * Anu domain: STRUCTURES. A flat raised stone platform on the east
 * side of the valley (opposite the dock) — the "future home" marker
 * where Tipi 1 + Tipi 2 will phase back in when those models are
 * brought over from v2. For now the pad reads as sacred ground waiting
 * to be filled: chunky hex-plate ringed by short standing stones, a
 * soft golden inner glow, and a single planting socket marker at the
 * centre.
 *
 * Why a single pad (not two): the user's eventual plan is two tipis
 * but for the kid-pad-of-possibility this turn we ship ONE clearly-
 * marked ceremonial ground. When Tipi 2 reaches us we'll either widen
 * the pad to host both or spawn a sibling pad — either is one diff.
 *
 * Triangle target: ~200 tris (deck hex + 8 short stones + glow rim).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

// Placement: east of the pool by ~18 m (clear of the south dock + hill ring).
const PAD_CENTER_X = 18;
const PAD_CENTER_Z = -2;
const PAD_RADIUS_M = 3.8;
const PAD_HEIGHT_M = 0.35;
const STONE_COUNT = 8;

let _deckGeo = null, _deckMat = null, _stoneGeo = null, _stoneMat = null;
let _glowGeo = null, _glowMat = null;

function deckGeo() {
  if (_deckGeo) return _deckGeo;
  // Cylinder with low segment count — reads as a hex/octagonal plate.
  _deckGeo = new THREE.CylinderGeometry(PAD_RADIUS_M, PAD_RADIUS_M + 0.15, PAD_HEIGHT_M, 8, 1);
  return _deckGeo;
}
function deckMat() {
  if (_deckMat) return _deckMat;
  _deckMat = new THREE.MeshStandardMaterial({
    color: 0x9a8d72,   // warm sandstone
    emissive: 0x1d1407,
    emissiveIntensity: 0.18,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  return _deckMat;
}
function stoneGeo() {
  if (_stoneGeo) return _stoneGeo;
  _stoneGeo = new THREE.CylinderGeometry(0.30, 0.40, 0.95, 7, 1);
  return _stoneGeo;
}
function stoneMat() {
  if (_stoneMat) return _stoneMat;
  _stoneMat = new THREE.MeshStandardMaterial({
    color: 0x5d6168,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  return _stoneMat;
}
function glowGeo() {
  if (_glowGeo) return _glowGeo;
  _glowGeo = new THREE.RingGeometry(PAD_RADIUS_M * 0.85, PAD_RADIUS_M * 0.96, 32);
  return _glowGeo;
}
function glowMat() {
  if (_glowMat) return _glowMat;
  _glowMat = new THREE.MeshBasicMaterial({
    color: 0xfbc02d,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return _glowMat;
}

export const SanctuaryVillagePadModule = {
  name: "SanctuaryVillagePad",

  _scene: null,
  _root: null,
  _glow: null,
  _elapsed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const root = new THREE.Group();
    root.name = "sanctuary_village_pad";
    root.userData.anuId = "structures.sanctuary.village_pad";
    root.userData.anuKind = "sanctuary_village_pad";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.ENTER, ANU_INTERACTION_VERB.INSPECT];

    // ── Deck plate. ──────────────────────────────────────────────────
    const deck = new THREE.Mesh(deckGeo(), deckMat());
    deck.position.y = PAD_HEIGHT_M / 2 + 0.02;
    // Shadow cost cut — the pad deck is flush to the ground heightfield;
    // its shadow merges with the terrain and isn't worth a caster slot.
    deck.castShadow = false;
    deck.receiveShadow = true;
    deck.name = "sanctuary_village_pad_deck";
    deck.userData.anuKind = "sanctuary_village_pad_deck";
    deck.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    root.add(deck);

    // ── Ring of standing stones. ─────────────────────────────────────
    for (let i = 0; i < STONE_COUNT; i++) {
      const ang = (i / STONE_COUNT) * Math.PI * 2;
      const stone = new THREE.Mesh(stoneGeo(), stoneMat());
      stone.position.set(
        Math.cos(ang) * (PAD_RADIUS_M + 0.2),
        0.95 / 2 + 0.02,
        Math.sin(ang) * (PAD_RADIUS_M + 0.2),
      );
      stone.rotation.y = ang + Math.random() * 0.2;
      stone.rotation.z = (Math.random() - 0.5) * 0.12;
      stone.castShadow = true;
      stone.receiveShadow = true;
      stone.name = "sanctuary_village_pad_stone";
      stone.userData.anuKind = "sanctuary_village_pad_stone";
      stone.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
      root.add(stone);
    }

    // ── Inner gold glow ring (animated pulse). ───────────────────────
    this._glow = new THREE.Mesh(glowGeo(), glowMat());
    this._glow.rotation.x = -Math.PI / 2;
    this._glow.position.y = PAD_HEIGHT_M + 0.04;
    this._glow.renderOrder = 9;
    this._glow.name = "sanctuary_village_pad_glow";
    this._glow.userData.anuKind = "sanctuary_village_pad_glow";
    this._glow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    root.add(this._glow);

    // ── Centre socket marker (where future tipi will plant). ─────────
    const socketGeo = new THREE.ConeGeometry(0.18, 0.40, 6);
    const socket = new THREE.Mesh(socketGeo, stoneMat());
    socket.position.set(0, PAD_HEIGHT_M + 0.20, 0);
    socket.castShadow = false; // tiny cone, sits under the tipi — invisible shadow
    socket.name = "sanctuary_village_pad_socket";
    socket.userData.anuKind = "sanctuary_village_pad_socket";
    socket.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    root.add(socket);

    const groundY = sanctuaryGroundY(PAD_CENTER_X, PAD_CENTER_Z);
    root.position.set(PAD_CENTER_X, groundY, PAD_CENTER_Z);
    // Visual ring + monolith stones retired May-19 2026 per user spec
    // ("remove yellow circles with those black dipi, all of them").
    // The anchor publication below still drives Tipi 1's placement; we
    // just don't render the pad scaffolding. Tipis are the only village
    // landmarks now.
    root.visible = false;
    scene.add(root);
    this._root = root;

    // Publish anchor on `window` so the future Tipi modules know where
    // to plant themselves when the phase-in flag is removed.
    if (typeof window !== "undefined") {
      window.__sanctuaryVillagePad = {
        x: PAD_CENTER_X,
        z: PAD_CENTER_Z,
        y: groundY + PAD_HEIGHT_M + 0.02,
        radius: PAD_RADIUS_M,
      };
    }

    console.log(
      `%c[Sanctuary] 🪨 Village build pad ready at (${PAD_CENTER_X}, ${PAD_CENTER_Z}) — awaits Tipi 1 phase-in.`,
      "color:#9a8d72;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._glow) return;
    this._elapsed += delta;
    // Slow pulse of the inner ring opacity — sells "sacred / waiting".
    this._glow.material.opacity = 0.30 + Math.sin(this._elapsed * 1.3) * 0.18;
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
    this._root = null;
    this._glow = null;
    this._scene = null;
    if (typeof window !== "undefined") delete window.__sanctuaryVillagePad;
  },
};
