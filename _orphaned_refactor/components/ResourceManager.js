import * as THREE from 'three';

export class ResourceManager {
    constructor(scene, renderPipeline) {
        this.scene = scene;
        this.renderPipeline = renderPipeline;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.interactableObjects = [];
        this.hoveredObject = null;
        this.selectedObject = null;

        // Player Inventory State
        this.inventory = {
            hasAxe: false,
            wood: 0,
            berries: 0
        };

        // UI for glow handling
        // Could be done via post-processing OutlinePass, but user requested high perf.
        // A simple material swap or scaling wireframe can simulate "cute outline glow".
        this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700, wireframe: true, transparent: true, opacity: 0.6 });

        this.bindEvents();
    }

    registerInteractable(mesh, type) {
        // e.g., type: 'tree' or 'bush'
        mesh.userData.interactableType = type;
        this.interactableObjects.push(mesh);
        
        // Add a hidden glow mesh child
        const glowMesh = new THREE.Mesh(mesh.geometry, this.glowMaterial);
        glowMesh.scale.multiplyScalar(1.05); // slightly larger
        glowMesh.visible = false;
        mesh.add(glowMesh);
        mesh.userData.glowMesh = glowMesh;
    }

    bindEvents() {
        window.addEventListener('mousemove', (e) => {
            // Keep track of mouse position for raycasting
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        window.addEventListener('click', () => {
            if (this.hoveredObject) {
                this.handleInteraction(this.hoveredObject);
            }
        });
    }

    update(deltaTime) {
        // Perform raycast from active camera
        this.raycaster.setFromCamera(this.mouse, this.renderPipeline.activeMainCamera);
        
        const intersects = this.raycaster.intersectObjects(this.interactableObjects, false);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            if (this.hoveredObject !== hit) {
                // Remove old glow
                if (this.hoveredObject && this.hoveredObject.userData.glowMesh) {
                    this.hoveredObject.userData.glowMesh.visible = false;
                }
                // Apply new glow
                this.hoveredObject = hit;
                if (this.hoveredObject.userData.glowMesh) {
                    this.hoveredObject.userData.glowMesh.visible = true;
                }
            }
        } else {
            // Clear glow
            if (this.hoveredObject && this.hoveredObject.userData.glowMesh) {
                this.hoveredObject.userData.glowMesh.visible = false;
            }
            this.hoveredObject = null;
        }
    }

    handleInteraction(mesh) {
        const type = mesh.userData.interactableType;
        
        if (type === 'tree') {
            if (this.inventory.hasAxe) {
                this.inventory.wood++;
                console.log("Chopped wood! Total: " + this.inventory.wood);
                // Remove or "fell" tree
                mesh.visible = false;
                this.interactableObjects = this.interactableObjects.filter(m => m !== mesh);
            } else {
                console.log("Need an axe to chop wood!");
                // Post to Journal iframe
                window.postMessage({ type: 'JOURNAL_LOG', text: "You try to chop the tree with your bare hands, but you need an axe." }, '*');
            }
        } else if (type === 'bush') {
            this.inventory.berries++;
            console.log("Collected berries! Total: " + this.inventory.berries);
            mesh.visible = false;
            this.interactableObjects = this.interactableObjects.filter(m => m !== mesh);
            window.postMessage({ type: 'JOURNAL_LOG', text: "You gathered some berries." }, '*');
        }
    }
}
