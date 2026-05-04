class CameraDirector {
    constructor() {
        this.targets = {}; // e.g. { compass: { x, y, w, h }, tipi: { x, y, w, h } }
        this.activeCamera = null;
        this.perspectiveMode = false;
    }

    // Register a bounding box for a PiP target
    setScissorBox(id, rect) {
        if (!rect) {
            delete this.targets[id];
        } else {
            this.targets[id] = rect;
        }
    }

    // Resolve which camera to use based on the Logbook target
    resolveTipiCamera(targetId, tipiOrthoCam, tipiPerspCam, swayT) {
        let camToUse = tipiOrthoCam;
        let handled = false;

        if (targetId === 'yellowButterfly' && window._yellowButterflyNPC) {
            camToUse = tipiPerspCam;
            const pos = new THREE.Vector3();
            window._yellowButterflyNPC.getWorldPosition(pos);
            // Stand in front of her (-Z local axis)
            const sxPortrait = Math.sin(swayT * 2.5) * 0.05;
            const syPortrait = Math.cos(swayT * 3.1) * 0.03;
            
            const offset = new THREE.Vector3(1, 1.3, 0).applyQuaternion(window._yellowButterflyNPC.quaternion);
            camToUse.position.copy(pos).add(offset);
            camToUse.position.x += sxPortrait;
            camToUse.position.y += syPortrait;
            
            const lookAtPoint = pos.clone();
            lookAtPoint.y += 1.3;
            camToUse.lookAt(lookAtPoint);
            handled = true;

        } else if (targetId === 'bringsHappinessGirlPortrait' && window._bhgGroup) {
            camToUse = tipiPerspCam;
            const facePos = new THREE.Vector3();
            if (window._bhgCharacterMesh) {
                window._bhgCharacterMesh.getWorldPosition(facePos);
            } else {
                facePos.copy(window._bhgGroup.position);
            }
            facePos.y += 1.0;

            const sxPortrait = Math.sin(swayT * 2.5) * 0.05;
            const syPortrait = Math.cos(swayT * 3.1) * 0.03;

            camToUse.position.set(facePos.x + 0.3 + sxPortrait, facePos.y - 0.1 + syPortrait, facePos.z - 1.5);
            camToUse.lookAt(facePos.x, facePos.y - 0.2, facePos.z);

            if (window._bhgWaveAction && window.bhgSystem) {
                window.bhgSystem.playerGreeted = true; 
                window._bhgWaveAction.reset().play();
            }
            handled = true;

        } else if (targetId === 'axe' || targetId === 'axe-3d-target') {
            camToUse = tipiOrthoCam;
            const axePos = new THREE.Vector3(3.2, 0.4, 9.8);
            if (window.axeObj) window.axeObj.getWorldPosition(axePos);
            
            const rot = (performance.now() * 0.0005) + Math.PI;
            const zoom = 1.0 + Math.sin(swayT * 0.3) * 0.2; 
            
            camToUse.position.set(
                axePos.x + Math.sin(rot) * zoom,
                axePos.y + 0.3,
                axePos.z + Math.cos(rot) * zoom
            );
            camToUse.lookAt(axePos.x, axePos.y, axePos.z);
            handled = true;
        } else if (targetId === 'bhg' && window._bhgGroup) {
            camToUse = tipiOrthoCam;
            const pos = new THREE.Vector3();
            window._bhgGroup.getWorldPosition(pos);
            camToUse.position.set(pos.x - 3 + Math.sin(swayT) * 0.5, pos.y + 3 + Math.cos(swayT * 0.8) * 0.5, pos.z - 6);
            camToUse.lookAt(pos.x, pos.y + 1, pos.z);
            handled = true;
        }

        // Generic rabbit fallback removed

        // Keep them safely synced to avoid NaNs
        if (camToUse === tipiOrthoCam) {
            tipiPerspCam.position.copy(tipiOrthoCam.position);
            tipiPerspCam.quaternion.copy(tipiOrthoCam.quaternion);
        } else {
            tipiOrthoCam.position.copy(tipiPerspCam.position);
            tipiOrthoCam.quaternion.copy(tipiPerspCam.quaternion);
        }

        return camToUse;
    }
}

window._CameraDirector = new CameraDirector();
