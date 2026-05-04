import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

export class Minimap {
    constructor(engine) {
        this.engine = engine;
        this.camera = null;
        this.renderer = null;
    }

    init() {
        const mapWrap = document.querySelector('#mapview-container .canvas-wrapper');
        if (!mapWrap) return;

        const frustum = 200;
        this.camera = new THREE.OrthographicCamera(-frustum, frustum, frustum, -frustum, 1, 1000);
        this.camera.position.set(0, 200, 0);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(0, 0, 0);
        this.camera.layers.enable(0);
        this.camera.layers.enable(5);

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
        this.renderer.setSize(mapWrap.clientWidth, mapWrap.clientHeight);
        mapWrap.appendChild(this.renderer.domElement);

        // Link to engine
        this.engine.camera = this.camera;
        this.engine.renderer = this.renderer;

        window.addEventListener('resize', () => this.onResize());
    }

    update(dt) {
        // Render
        const oldFog = this.engine.scene.fog;
        this.engine.scene.fog = null;
        this.renderer.render(this.engine.scene, this.camera);
        this.engine.scene.fog = oldFog;

        // Day/Night Ring
        const ring = document.getElementById('day-night-ring');
        if (ring) {
            const deg = (this.engine.gameTime / 24) * 360;
            ring.style.transform = `rotate(${deg}deg)`;
        }
    }

    onResize() {
        const mapWrap = document.querySelector('#mapview-container .canvas-wrapper');
        if(!mapWrap || !this.camera) return;

        const aspect = mapWrap.clientWidth / mapWrap.clientHeight;
        const frustumSize = 150;
        this.camera.left = -frustumSize * aspect / 2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = -frustumSize / 2;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(mapWrap.clientWidth, mapWrap.clientHeight);
    }
}
