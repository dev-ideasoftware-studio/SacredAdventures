import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

export class FPV {
    constructor(engine) {
        this.engine = engine;
        this.camera = null;
        this.renderer = null;
        this.lastPos = new THREE.Vector3();
    }

    init() {
        const fpvWrap = document.getElementById('fpv-viewport');
        if (!fpvWrap) return;

        this.camera = new THREE.PerspectiveCamera(75, fpvWrap.clientWidth / fpvWrap.clientHeight, 0.1, 200);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(fpvWrap.clientWidth, fpvWrap.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        fpvWrap.appendChild(this.renderer.domElement);

        // Link to engine for movement updates
        this.engine.fpvCamera = this.camera;
        this.engine.fpvRenderer = this.renderer;

        window.addEventListener('resize', () => this.onResize());
    }

    update(dt) {
        // DOF Effect
        if(this.camera) {
            const currentPos = this.camera.position;
            const dist = currentPos.distanceTo(this.lastPos);
            this.engine.moveSpeedVal = (this.engine.moveSpeedVal || 0) + (dist - (this.engine.moveSpeedVal || 0)) * 0.1;
            const blur = Math.min(4, (this.engine.moveSpeedVal || 0) * 8);
            this.renderer.domElement.style.filter = `blur(${blur}px)`;
            this.lastPos.copy(currentPos);
            
            // Render only if NOT in cinematic mode (Engine handles cinematic render)
            // Actually Engine.animate calls updateCinematic which renders.
            // But if NOT cinematic, we need to render here or in Engine.
            // Engine.js `animate` calls `updateGameLogic` then loops components `update`.
            // But `Engine.js` typically renders in `animate`.
            // Let's modify logic: FPV component does the render call 
            // BUT Engine expects to manage the loop. 
            // In Engine.js:
            /*
                // Cinematic Override
                if (this.cinematicMode) {
                   this.updateCinematic(dt, now); // This renders
                } else {
                   this.updateGameLogic(dt);
                }
                // ...
                // Update Components
                this.components.forEach(c => { if(c.update) c.update(dt); });
            */
            // So if NOT cinematic, we need to render.
            if(!this.engine.cinematicMode) {
                this.renderer.render(this.engine.scene, this.camera);
            }
        }
    }

    onResize() {
        const fpvWrap = document.getElementById('fpv-viewport');
        if(!fpvWrap || !this.camera) return;
        this.camera.aspect = fpvWrap.clientWidth / fpvWrap.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(fpvWrap.clientWidth, fpvWrap.clientHeight);
    }
}
