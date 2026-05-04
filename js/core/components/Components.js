import * as THREE from 'three';
import { Component } from '../Component.js';

export class TransformComponent extends Component {
    constructor(x = 0, y = 0, z = 0) {
        super();
        this.position = new THREE.Vector3(x, y, z);
        this.rotation = new THREE.Euler();
        this.scale = new THREE.Vector3(1, 1, 1);
    }
}

export class MeshComponent extends Component {
    constructor(mesh) {
        super();
        this.mesh = mesh; // THREE.Object3D or THREE.Group
        this.isLoaded = !!mesh;
        this.path = null;
    }
}

export class AnimationComponent extends Component {
    constructor() {
        super();
        this.mixer = null;
        this.actions = {};
        this.activeAction = null;
    }
    
    update(deltaTime) {
        if (this.mixer) this.mixer.update(deltaTime);
    }
}

export class InteractableComponent extends Component {
    constructor(config = {}) {
        super();
        this.proximityDist = config.proximityDist || 3.0; // 10 feet approx
        this.animOnProximity = config.animOnProximity || 'heart';
        this.facePlayer = !!config.facePlayer;
        this.hasBloom = !!config.hasBloom;
        this.hasBalloon = !!config.hasBalloon;
        
        this.balloonMesh = null;
        this.bloomLight = null;
        this.isTriggered = false;
        
        this.idleActionId = config.idleActionId || 'idle';
    }
}
