// ======================================================================
// EngineState.js — Shared Mutable State Singleton
// ======================================================================
// All engine modules import this object to share state.
// Properties are set by EngineMain.init() and read/written by all modules.
// ======================================================================

import * as THREE from 'three';

export const S = {
    // --- Core Three.js Objects (set in init) ---
    scene: null,
    camera: null,
    renderer: null,
    clock: null,

    // --- Player State ---
    player: { x: 0, z: 0, rot: 0, speed: 0, dy: 0 },
    keys: {
        w: false, a: false, s: false, d: false,
        arrowup: false, arrowdown: false, arrowleft: false, arrowright: false
    },

    // --- Timing ---
    gameTime: 8.0,
    frameCount: 0,
    headBobTimer: 0,

    // --- Cameras ---
    pipCamera: null,
    tipiOrthoCam: null,
    axePipCam: null,

    // --- Systems ---
    fuzzyBrain: null,
    humanEyePass: null,
    opticalMask: null,
    deerSystem: null,
    rabbitSystem: null,
    birdSystem: null,
    squirrelSystem: null,
    axeRenderer: null,

    // --- Pre-allocated Vectors (movement) ---
    _dir: new THREE.Vector3(),
    _right: new THREE.Vector3(),
    _up: new THREE.Vector3(0, 1, 0),
    _walkDir: new THREE.Vector3(),
    _pipFwd: new THREE.Vector3(),
    _avCamDir: new THREE.Vector3(),

    // --- Pre-allocated Objects (render passes) ---
    _pipColor: new THREE.Color(),
    _pipPos: new THREE.Vector3(),
    _pipFwd2: new THREE.Vector3(),
    _pipWp: new THREE.Vector3(),
    _pipDir: new THREE.Vector3(),
    _pipMatrix: new THREE.Matrix4(),
    _pipQuat: new THREE.Quaternion(),

    // --- Render Throttling ---
    _secondaryRenderCounter: 0,
    SECONDARY_RENDER_INTERVAL: 6, // ~10fps at 60fps

    // --- Click-to-move Marker ---
    _marker: null,
    _markerAdded: false,

    // --- DOM Cache ---
    _timeEl: null,
    _statsEl: null,
    _moonFrame: null,

    // --- Misc ---
    cameraPitch: 0,
    birdsong: null,
};

// Initialize geometry-dependent objects
const _markerGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 24);
_markerGeo.rotateX(Math.PI / 2);
const _markerMat = new THREE.MeshStandardMaterial({
    color: 0xffd700, emissive: 0xffa000, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.7
});
S._marker = new THREE.Mesh(_markerGeo, _markerMat);
S._marker.visible = false;
S._marker.renderOrder = 998;

// Cache DOM elements after DOM ready
export function cacheDOMElements() {
    S._timeEl = document.getElementById('time-display');
    S._statsEl = document.getElementById('dev-fps') || document.getElementById('stats-hud');
    S._moonFrame = document.getElementById('moondial-frame');
}
