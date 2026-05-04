// ======================================================================
// EngineMovement.js — Player Movement, Auto-Walk, Chopping, Head Bob
// ======================================================================
// Extracted from EngineMain.js animate() lines 2783-3107.
// Handles WASD/arrow movement, thumbstick input, click-to-move auto-walk,
// chopping progress animation, head bob, gravity, and quest proximity.
// ======================================================================

import * as THREE from 'three';
import { S } from './EngineState.js';

/**
 * Process all player movement for this frame.
 * @param {number} delta - Frame delta time
 * @returns {boolean} isMoving - Whether the player moved this frame
 */
export function updateMovement(delta) {
    const camera = S.camera;
    const keys = S.keys;
    const player = S.player;
    const SPEED = 5.0;
    const TURN_SPEED = 2.0;
    let isMoving = false;

    // --- PASSIVE GRAVITY (Follow Terrain) ---
    const x = camera.position.x;
    const z = camera.position.z;
    const groundY = window._getGroundY ? window._getGroundY(x, z)
        : Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2 + Math.sin(x * 0.3 + z * 0.2) * 0.5;

    if (!window._isCinematic) {
        // 1. Rotation (Keyboard A/D + Arrows)
        if (keys.arrowleft || keys.a) { camera.rotation.y += TURN_SPEED * delta; }
        if (keys.arrowright || keys.d) { camera.rotation.y -= TURN_SPEED * delta; }

        // 2. Direction Vectors (reuse pre-allocated)
        camera.getWorldDirection(S._dir);
        S._dir.y = 0; S._dir.normalize();

        // In map/top-down view, derive direction strictly from yaw angle
        if (window._isMapView) {
            const yaw = camera.rotation.y;
            S._dir.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
        }

        S._right.crossVectors(S._dir, S._up).normalize();

        // 3. Move (WASD + Arrows)
        if (keys.w || keys.arrowup) { camera.position.addScaledVector(S._dir, SPEED * delta); isMoving = true; }
        if (keys.s || keys.arrowdown) { camera.position.addScaledVector(S._dir, -SPEED * delta); isMoving = true; }

        // 3a. Virtual thumbstick (from panel iframe)
        const tx = window._thumbX || 0;
        const ty = window._thumbY || 0;
        if (Math.abs(tx) > 0.1 || Math.abs(ty) > 0.1) {
            if (Math.abs(tx) > 0.1) {
                camera.rotation.y -= tx * TURN_SPEED * 1.5 * delta;
            }
            if (Math.abs(ty) > 0.1) {
                camera.position.addScaledVector(S._dir, -ty * SPEED * delta);
                isMoving = true;
            }
        }

        // 3b. CLICK-TO-MOVE auto-walk
        if (window._moveTarget && !isMoving) {
            const target = window._moveTarget;
            const dx = target.x - camera.position.x;
            const dz = target.z - camera.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist > 1.2) {
                S._dir.set(dx, 0, dz).normalize();
                const currentSpeed = window._slowWalkcinematic ? (SPEED * 0.3) : SPEED;
                camera.position.addScaledVector(S._dir, currentSpeed * delta);

                if (!window._activeLookTarget) {
                    const targetAngle = Math.atan2(dx, dz) + Math.PI;
                    let diff = targetAngle - camera.rotation.y;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    camera.rotation.y += diff * delta * 5.0;
                }
                isMoving = true;
            } else {
                window._moveTarget = null;
                window._activeLookTarget = null;
                if (window._autoWalkCompleteEvent) {
                    window._autoWalkCompleteEvent();
                    window._autoWalkCompleteEvent = null;
                }
                if (window._choppingTarget && !window._isCinematic) {
                    if (window._choppingTimer === undefined || window._choppingTimer === null) {
                        window._choppingTimer = 1.2;
                    }
                } else if (!window._isCinematic) {
                    window._moveTarget = null;
                }
                if (window._lookTarget) {
                    window._activeLookTarget = window._lookTarget;
                    window._lookTarget = null;
                }
            }
        } else if (isMoving && (window._moveTarget || (window._choppingTimer || 0) > 0)) {
            window._moveTarget = null;
            window._lookTarget = null;
            window._activeLookTarget = null;
            window._choppingTarget = null;
            window._choppingTimer = 0;
        }
    } // End of !window._isCinematic

    // --- PROXIMITY QUEST TRIGGER ---
    if (window.SacredState && window.SacredState.questLevel === 2 && window._bhgGroup && !window._isCinematic && !window._pendingTipiGreeting) {
        const dx = camera.position.x - window._bhgGroup.position.x;
        const dz = camera.position.z - window._bhgGroup.position.z;
        if ((dx * dx + dz * dz) < 144) {
            window.SacredState.questLevel = 3;
            window._hasTriggeredGirlQuest = true;
            if (window._questMarker2) window._questMarker2.visible = false;
            setTimeout(() => {
                const panel = document.getElementById('panel-frame');
                if (panel && panel.contentWindow) {
                    panel.contentWindow.postMessage({ type: 'FORCE_OPEN_FOUND_HER' }, '*');
                }
            }, 500);
        }
    }

    // --- CHOPPING PROGRESS ---
    if ((window._choppingTimer || 0) > 0) {
        window._choppingTimer -= delta;

        // Animate FPV Axe Swinging
        if (window._equippedAxe && window._equippedAxe.visible) {
            const swingPhase = (1.6 - window._choppingTimer) * Math.PI * 4;
            const dip = Math.sin(swingPhase);
            window._equippedAxe.rotation.x = window._equippedAxe._baseRotation.x + Math.max(0, dip) * 1.5;
            window._equippedAxe.position.y = -0.6 - Math.max(0, dip) * 0.4;
        }

        if (window._choppingTarget) {
            window._choppingTarget.rotation.z = Math.sin(Date.now() * 0.05) * 0.03;
            const t = window._choppingTarget.position;
            const c = camera.position;
            const chopAngle = Math.atan2(t.x - c.x, t.z - c.z);
            camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, chopAngle, delta * 10);
        } else if (window._chopTargetInstanceId !== null && window._chopTargetInstanceId !== undefined) {
            const dip = Math.sin((1.6 - window._choppingTimer) * Math.PI * 4);
            if (dip > 0.95) camera.rotation.x += Math.random() * 0.005 - 0.0025;
        }

        if (window._choppingTimer <= 0) {
            if (window._equippedAxe) window._equippedAxe.visible = false;

            if (window._choppingTarget) {
                if (typeof window.chopTree === 'function') window.chopTree(window._choppingTarget, S.scene);
                window._choppingTarget = null;
            } else if (window._chopTargetInstanceId !== null && window._chopTargetInstanceId !== undefined) {
                const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
                if (window._chopTargetMesh && window._chopTargetMesh.userData && window._chopTargetMesh.userData.chunkSiblings) {
                    window._chopTargetMesh.userData.chunkSiblings.forEach(({ instancedMesh }) => {
                        instancedMesh.setMatrixAt(window._chopTargetInstanceId, zeroMatrix);
                        instancedMesh.instanceMatrix.needsUpdate = true;
                    });
                }
                if (window._treeHighlightMesh) window._treeHighlightMesh.visible = false;
                window._selectedTreeId = null;
                window._chopTargetInstanceId = null;

                if (window.parent) window.parent.postMessage({ type: 'LOG_TEXT', text: "You chopped down a pine tree." }, '*');
                const woodAmount = Math.floor(Math.random() * 3) + 1;
                if (window.parent) window.parent.postMessage({ type: 'RESOURCE_UPDATE', resource: 'wood', amount: woodAmount }, '*');
            }
            window._moveTarget = null;
            window._choppingTimer = 0;
        }
        return isMoving; // Freeze movement while chopping
    }

    // --- LOOK TARGET ---
    if (window._activeLookTarget) {
        const t = window._activeLookTarget;
        const dx = t.x - camera.position.x;
        const dz = t.z - camera.position.z;
        const targetAngle = Math.atan2(-dx, -dz);
        let angleDiff = targetAngle - camera.rotation.y;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        if (Math.abs(angleDiff) > 0.02) {
            camera.rotation.y += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_SPEED * 1.5 * delta);
        } else {
            if (!isMoving) {
                window._activeLookTarget = null;
                if (window._lookCompleteEvent) {
                    window._lookCompleteEvent();
                    window._lookCompleteEvent = null;
                }
            }
        }
    }

    // --- CLICK-TO-MOVE VISUAL INDICATOR ---
    if (!S._markerAdded && S.scene) {
        S.scene.add(S._marker);
        S._markerAdded = true;
    }
    if (window._moveTarget) {
        const t = window._moveTarget;
        const groundAtTarget = window._getGroundY ? window._getGroundY(t.x, t.z)
            : Math.sin(t.x * 0.1) * Math.cos(t.z * 0.1) * 2 + Math.sin(t.x * 0.3 + t.z * 0.2) * 0.5;
        S._marker.visible = false;
        S._marker.position.set(t.x, groundAtTarget + 0.05, t.z);
        S._marker.material.opacity = 0.5 + Math.sin(performance.now() * 0.004) * 0.2;
    } else {
        S._marker.visible = false;
    }

    // --- AXE HOVER PHYSICS ---
    if (window._worldAxeMesh) {
        window._worldAxeMesh.position.y = 1.2 + Math.sin(performance.now() * 0.002) * 0.15;
        window._worldAxeMesh.rotation.y += delta * 0.5;
    }

    // --- HEAD BOB ---
    let bobOffset = 0;
    if (isMoving || window._isCinematicWalking) {
        S.headBobTimer += delta * 12;
        bobOffset = Math.sin(S.headBobTimer) * 0.15;

        // Quest proximity distance update
        const panelFrame = document.getElementById('panel-frame');
        if (panelFrame && panelFrame.contentWindow) {
            let nearestDist = Infinity;
            let nearestId = 'tipi';

            if (!window._questMarker || window._questMarker.visible) {
                const dTipi = Math.sqrt(Math.pow(camera.position.x - 0, 2) + Math.pow(camera.position.z - 0, 2));
                if (dTipi < nearestDist) { nearestDist = dTipi; nearestId = 'tipi'; }
            }
            if (window._bhgBalloon && window._bhgBalloon.visible) {
                const dBhg = Math.sqrt(Math.pow(camera.position.x - 35, 2) + Math.pow(camera.position.z - 45, 2));
                if (dBhg < nearestDist) { nearestDist = dBhg; nearestId = 'bhg'; }
            }
            if (nearestDist === Infinity) {
                nearestDist = Math.sqrt(Math.pow(camera.position.x - 0, 2) + Math.pow(camera.position.z - 0, 2));
            }
            const distFeet = Math.round(nearestDist * 3.28084);
            if (!window._lastDistFeet || Math.abs(window._lastDistFeet - distFeet) >= 2 || window._lastNearestId !== nearestId) {
                window._lastDistFeet = distFeet;
                window._lastNearestId = nearestId;
                panelFrame.contentWindow.postMessage({ type: 'QUEST_DISTANCE_UPDATE', distance: distFeet, nearestId: nearestId }, '*');
            }
        }
    } else {
        S.headBobTimer = 0;
    }

    // Movement state notification
    if (isMoving !== window._lastMovingState) {
        window._lastMovingState = isMoving;
        const panelFrame = document.getElementById('panel-frame');
        if (panelFrame && panelFrame.contentWindow) {
            panelFrame.contentWindow.postMessage({ type: 'playerMoving', moving: isMoving }, '*');
        }
    }

    // --- GRAVITY ---
    const BASE_HEIGHT = 1.7;
    const GRAVITY = 9.8;
    player.dy = (player.dy || 0) - GRAVITY * delta;
    let targetY = camera.position.y + player.dy * delta;
    if (targetY < groundY + BASE_HEIGHT + bobOffset) {
        camera.position.y = groundY + BASE_HEIGHT + bobOffset;
        player.dy = 0;
    } else {
        camera.position.y = targetY;
    }

    player.x = camera.position.x;
    player.z = camera.position.z;
    player.rot = camera.rotation.y;

    // --- PATHFINDING VISUAL UPDATE ---
    if (window._moveTarget && window._pathLine && window._targetRing) {
        window._pathLine.visible = true;
        window._targetRing.visible = true;
        window._targetRing.position.set(window._moveTarget.x, (window.envBuilder && typeof window.envBuilder.getGroundY === 'function') ? window.envBuilder.getGroundY(window._moveTarget.x, window._moveTarget.z) + 0.1 : 0.1, window._moveTarget.z);
        window._targetRing.scale.setScalar(1.0 + Math.sin(S.gameTime * 10) * 0.1);

        const positions = window._pathLine.geometry.attributes.position.array;
        positions[0] = camera.position.x;
        positions[1] = groundY + 0.2;
        positions[2] = camera.position.z;
        positions[3] = window._moveTarget.x;
        positions[4] = window._targetRing.position.y;
        positions[5] = window._moveTarget.z;
        window._pathLine.geometry.attributes.position.needsUpdate = true;
        window._pathLine.computeLineDistances();
        window._pathLine.material.dashOffset -= delta * 5.0;
    } else if (window._pathLine && window._targetRing) {
        window._pathLine.visible = false;
        window._targetRing.visible = false;
    }

    return isMoving;
}
