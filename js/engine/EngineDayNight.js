// ======================================================================
// EngineDayNight.js — Day/Night Cycle, Sky, Sun, Moon, Compass
// ======================================================================
// Extracted from EngineMain.js animate() lines 3204-3354.
// Handles time advancement, sky color interpolation, sun/moon positioning,
// and compass UI synchronization.
// ======================================================================

import * as THREE from 'three';
import { S } from './EngineState.js';

/**
 * Update the day/night cycle, sky colors, sun/moon positions, and compass UI.
 * @param {number} delta - Frame delta time
 */
export function updateDayNight(delta) {
    const camera = S.camera;

    // --- TIME ADVANCEMENT ---
    if (window._targetGameTime !== undefined) {
        window._manualTimeMode = true;
        const diff = window._targetGameTime - S.gameTime;
        if (Math.abs(diff) < 0.1) {
            S.gameTime = window._targetGameTime;
            window._targetGameTime = undefined;
        } else {
            S.gameTime += diff * delta * 2.0;
        }
    } else if (window._isTimeLocked) {
        // Time is explicitly locked by God Mode
    } else if (!window._manualTimeMode) {
        S.gameTime += delta * 0.005;
        if (S.gameTime >= 24) S.gameTime -= 24;
    } else {
        S.gameTime += delta * 0.01;
        if (S.gameTime >= 24) S.gameTime -= 24;
    }

    // --- SKY COLOR INTERPOLATION ---
    if (window._skyUniforms && window._sceneFog && window._sceneTarget) {
        const ND = { t: [6, 11, 19], m: [13, 27, 42], b: [58, 69, 85], f: [58, 69, 85], i: 0.1 };
        const DW = { t: [58, 90, 122], m: [125, 164, 199], b: [201, 213, 227], f: [201, 213, 227], i: 0.6 };
        const DY = { t: [255, 170, 34], m: [255, 213, 128], b: [255, 241, 202], f: [255, 241, 202], i: 1.0 };
        const DK = { t: [65, 82, 112], m: [220, 140, 80], b: [255, 190, 120], f: [255, 190, 120], i: 0.4 };
        const GY = { t: [140, 145, 150], m: [160, 165, 170], b: [180, 185, 190], f: [180, 185, 190], i: 0.5 };

        let p1, p2, prog;
        if (window._isOvercastMode) {
            p1 = GY; p2 = GY; prog = 1.0;
        } else if (S.gameTime >= 4 && S.gameTime < 8) { p1 = ND; p2 = DW; prog = (S.gameTime - 4) / 4; }
        else if (S.gameTime >= 8 && S.gameTime < 11) { p1 = DW; p2 = DY; prog = (S.gameTime - 8) / 3; }
        else if (S.gameTime >= 11 && S.gameTime < 17) { p1 = DY; p2 = DY; prog = 1.0; }
        else if (S.gameTime >= 17 && S.gameTime < 20) { p1 = DY; p2 = DK; prog = (S.gameTime - 17) / 3; }
        else if (S.gameTime >= 20 && S.gameTime < 22) { p1 = DK; p2 = ND; prog = (S.gameTime - 20) / 2; }
        else { p1 = ND; p2 = ND; prog = 1.0; }

        const lerpRGB = (arr1, arr2, p) => new THREE.Color(
            (arr1[0] + (arr2[0] - arr1[0]) * p) / 255.0,
            (arr1[1] + (arr2[1] - arr1[1]) * p) / 255.0,
            (arr1[2] + (arr2[2] - arr1[2]) * p) / 255.0
        );

        window._skyUniforms.topColor.value.copy(lerpRGB(p1.t, p2.t, prog));
        window._skyUniforms.midColor.value.copy(lerpRGB(p1.m, p2.m, prog));
        window._skyUniforms.bottomColor.value.copy(lerpRGB(p1.b, p2.b, prog));

        const fogColor = lerpRGB(p1.f, p2.f, prog);
        window._sceneFog.color.copy(fogColor);
        window._sceneTarget.background.copy(fogColor);

        if (window.sunLight) {
            window.sunLight.intensity = Math.max(p1.i + (p2.i - p1.i) * prog, 0.1);
        }
    }

    // --- SUN POSITION ---
    const angle = (S.gameTime / 24) * Math.PI * 2 - Math.PI / 2;
    if (window.sunLight) {
        const rx = camera.position.x + Math.cos(angle) * 100;
        const ry = Math.sin(angle) * 100;
        const rz = camera.position.z - 30;
        window.sunLight.position.set(rx, Math.max(ry, -10), rz);
        window.sunLight.target.position.copy(camera.position);
        window.sunLight.target.updateMatrixWorld();
    }

    // --- MOON POSITION ---
    if (window._3dMoonGroup && window._3dMoonGroup.visible) {
        if (camera && camera.isPerspectiveCamera) {
            const fwd = S._dir; // Reuse pre-allocated vector
            camera.getWorldDirection(fwd);
            fwd.y = 0; fwd.normalize();

            window._3dMoonGroup.position.set(
                camera.position.x + fwd.x * 250,
                camera.position.y + 60,
                camera.position.z + fwd.z * 250
            );

            if (window._3dMoonMesh && window._currentForcePhase !== undefined) {
                const phaseMod = Math.abs(window._currentForcePhase - 4) / 4;
                window._3dMoonMesh.scale.x = (window._currentForcePhase === 0) ? 0.01 : 1.0;
                window._3dMoonMesh.material.emissiveIntensity = 1.0 - (phaseMod * 0.9);
            }
        }
    }

    // --- UI TIME DISPLAY ---
    const hours = Math.floor(S.gameTime);
    const minutes = Math.floor((S.gameTime - hours) * 60);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const timeStr = `${h12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm} `;
    if (S._timeEl) S._timeEl.innerText = timeStr;

    // --- CELESTIAL DIAL ---
    const celestialDial = document.getElementById('celestial-dial');
    if (celestialDial) {
        const dialAngle = ((S.gameTime - 12) / 24) * 360;
        celestialDial.style.transform = `rotate(${dialAngle}deg)`;

        const cSun = document.getElementById('c-sun');
        const cMoon = document.getElementById('c-moon');
        if (cSun) cSun.style.transform = `translateX(-50%) rotate(${-dialAngle}deg)`;
        if (cMoon) cMoon.style.transform = `translateX(-50%) rotate(${-dialAngle + 180}deg)`;
    }

    // --- MOON PHASE SYNC ---
    window.postMessage({ type: 'UPDATE_MOON', time: S.gameTime }, '*');

    // --- COMPASS SYNC ---
    const compassRing = document.querySelector('.compass-outer-ring');
    const compassTextLayer = document.querySelector('.compass-text-layer');

    if (compassRing) {
        const compassTurnDeg = THREE.MathUtils.radToDeg(camera.rotation.y);
        compassRing.style.transform = `rotate(${compassTurnDeg}deg)`;

        if (compassTextLayer) {
            compassTextLayer.style.transform = `rotate(${compassTurnDeg}deg)`;
            compassTextLayer.querySelectorAll('.compass-marker').forEach(marker => {
                if (marker.classList.contains('e') || marker.classList.contains('w')) {
                    marker.style.transform = `translateY(-50%) rotate(${-compassTurnDeg}deg)`;
                } else {
                    marker.style.transform = `translateX(-50%) rotate(${-compassTurnDeg}deg)`;
                }
            });
        }
    }
}
