import * as THREE from 'three';

export class HexGridManager {
    constructor(scene) {
        this.scene = scene;
        this.hexSize = 3.048; // API calls for 20ft (approx 6.096m diameter, so 3.048m radius)
        this.gridGroup = new THREE.Group();
        this.gridGroup.position.y = 0.05; // Slightly above ground
        this.scene.add(this.gridGroup);
        
        this.hexCells = new Map();
        this.isVisible = false;
        
        // Hide by default (FPV is starting mode usually, but depends on Engine state)
        this.gridGroup.visible = this.isVisible;
    }

    generateGrid(width, height) {
        const material = new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.5 });
        
        const widthDist = Math.sqrt(3) * this.hexSize;
        const heightDist = 2 * this.hexSize * (3/4);

        for (let r = -height/2; r < height/2; r++) {
            for (let q = -width/2; q < width/2; q++) {
                // Axial to world coordinates
                const x = (q + r/2) * widthDist;
                const z = r * heightDist;

                const hexMesh = this.createHexagonShape(material);
                hexMesh.position.set(x, 0, z);
                hexMesh.rotation.x = -Math.PI / 2; // Lie flat

                this.gridGroup.add(hexMesh);
                
                // Store cell data
                const key = `${r},${q}`;
                this.hexCells.set(key, { mesh: hexMesh, occupied: false });
            }
        }
    }

    createHexagonShape(material) {
        const points = [];
        for (let i = 0; i <= 6; i++) {
            const angle_deg = 60 * i - 30;
            const angle_rad = Math.PI / 180 * angle_deg;
            points.push(new THREE.Vector3(
                this.hexSize * Math.cos(angle_rad),
                this.hexSize * Math.sin(angle_rad),
                0
            ));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    }

    setGridVisibility(visible) {
        this.isVisible = visible;
        this.gridGroup.visible = this.isVisible;
    }

    // Helper for finding a hex under a raycast
    getHexFromWorldPos(vec3) {
        // axial rounding algorithms would go here
        // fallback primitive distance check
    }
}
