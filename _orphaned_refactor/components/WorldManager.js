import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class WorldManager {
    constructor(scene, fuzzyBrain) {
        this.scene = scene;
        this.fuzzyBrain = fuzzyBrain;
        
        // Expose global constants for placement
        this.TIPI_X = 0;
        this.TIPI_Z = 0;
        this.CLEARING_R = 30;
        this.HILL_INNER = 30;
        this.HILL_OUTER = 60;
        this.HILL_HEIGHT = 4.0;
        
        // State
        this.allTrees = [];
        this.swayTrees = [];
        this.instancedMeshes = [];
        
        // Shader timing
        this.globalTime = { value: 0 };
        this.mapViewCutout = { value: new THREE.Vector4(0, 0, 0, 0) };
    }

    getGroundY(gx, gz) {
        // 1. BASE — gentle undulation everywhere
        let baseNoise = Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5
            + Math.sin(gx * 0.2 + gz * 0.15) * 0.4;
        let y = baseNoise;

        const dx = gx - this.TIPI_X, dz = gz - this.TIPI_Z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // 2. SACRED CLEARING — 100-foot flat valley floor
        if (dist < this.CLEARING_R) {
            if (dist < 12.0) {
                y = 0; 
            } else {
                const t = (dist - 12.0) / (this.CLEARING_R - 12.0);
                const flatten = 0.5 + 0.5 * Math.cos(t * Math.PI); 
                y = baseNoise * (1.0 - flatten);
            }
        }

        // 2b. BRINGS HAPPINESS GIRL TIPI PLATEAU (Quest Tipi)
        const plateauX = 12;
        const plateauZ = 12;
        const dx2 = gx - plateauX, dz2 = gz - plateauZ;
        const dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
        
        if (dist2 < 12.0) {
            const plateauY = Math.sin(plateauX * 0.08) * Math.cos(plateauZ * 0.1) * 1.5 + Math.sin(plateauX * 0.2 + plateauZ * 0.15) * 0.4;
            if (dist2 < 6.0) {
                y = plateauY; // Flat ground for the Tipi interior and girl
            } else {
                // Smooth blend from plateau to full undulation
                const t2 = (dist2 - 6.0) / 6.0;
                const flatten2 = 0.5 + 0.5 * Math.cos(t2 * Math.PI); 
                y = y * (1.0 - flatten2) + plateauY * flatten2;
            }
        }

        // 3. PROTECTIVE HILLS — steep ring around the valley
        if (dist >= this.HILL_INNER && dist < this.HILL_OUTER) {
            const t = (dist - this.HILL_INNER) / (this.HILL_OUTER - this.HILL_INNER);
            const hillShape = Math.sin(t * Math.PI);
            const angle = Math.atan2(dz, dx);
            const noise = 0.65 + 0.35 * Math.sin(angle * 3 + 0.8) * Math.sin(angle * 5 + 2.1) * 0.3;
            const lobe = 0.7 + 0.3 * Math.sin(angle * 2.3 + 1.2);
            y += this.HILL_HEIGHT * hillShape * (noise + 0.5) * lobe;
        }

        // 4. ROLLING HILLS — outer terrain
        if (dist > this.HILL_OUTER) {
            const outerBlend = Math.min(1.0, (dist - this.HILL_OUTER) / 10);
            const rollingH = Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.5
                + Math.sin(gx * 0.12 + gz * 0.1) * 1.0;
            y += rollingH * outerBlend;
        }

        const edgeDistX = Math.max(0, Math.abs(gx) - 100); 
        const edgeDistZ = Math.max(0, Math.abs(gz) - 100); 
        const maxEdge = Math.max(edgeDistX, edgeDistZ); 
        if (maxEdge > 0) {
            const flattenT = Math.min(1.0, maxEdge / 20.0);
            y = y * (1.0 - flattenT);
        }

        return y;
    }

    async generateBreathtakingWorld() {
        this.setupLighting();
        this.setupSkyAndAtmosphere();
        this.setupDeformedGround();
        await this.plantSacredForest();
    }

    setupLighting() {
        const hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x3a5f3a, 0.8);
        hemiLight.layers.enableAll();
        this.scene.add(hemiLight);

        const sunLight = new THREE.DirectionalLight(0xffe0a0, 2.0);
        sunLight.layers.enableAll();
        sunLight.position.set(40, 35, -20);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 300;
        sunLight.shadow.bias = -0.0001;

        const sCamSize = 120;
        sunLight.shadow.camera.left = -sCamSize;
        sunLight.shadow.camera.right = sCamSize;
        sunLight.shadow.camera.top = sCamSize;
        sunLight.shadow.camera.bottom = -sCamSize;

        this.scene.add(sunLight);
        this.scene.add(sunLight.target);
        
        if (this.fuzzyBrain) {
            this.fuzzyBrain.registerShadowLight(sunLight);
        }

        const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.4);
        fillLight.layers.enableAll();
        fillLight.position.set(-30, 20, 30);
        this.scene.add(fillLight);
    }

    setupSkyAndAtmosphere() {
        const skyGeo = new THREE.SphereGeometry(600, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                topColor: { value: new THREE.Color(0x2a9df4) },
                midColor: { value: new THREE.Color(0x87CEEB) },
                bottomColor: { value: new THREE.Color(0x8da399) },
                offset: { value: 20 },
                exponent: { value: 0.5 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 midColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    if (h < 0.0) {
                        gl_FragColor = vec4(bottomColor, 1.0);
                    } else if (h < 0.3) {
                        float t = h / 0.3;
                        gl_FragColor = vec4(mix(bottomColor, midColor, t), 1.0);
                    } else {
                        float t = (h - 0.3) / 0.7;
                        gl_FragColor = vec4(mix(midColor, topColor, pow(t, exponent)), 1.0);
                    }
                }
            `
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(sky);

        this.scene.background = new THREE.Color(0x8da399);
        this.scene.fog = new THREE.FogExp2(0x8da399, 0.0035);
    }

    setupDeformedGround() {
        const size = 300;
        const resolution = 256;
        const groundGeo = new THREE.PlaneGeometry(size, size, resolution, resolution);
        groundGeo.rotateX(-Math.PI / 2);
        
        const positions = groundGeo.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            const gx = positions[i];
            const gz = positions[i + 2];
            positions[i + 1] = this.getGroundY(gx, gz);
        }
        groundGeo.computeVertexNormals();

        const textureLoader = new THREE.TextureLoader();
        const groundTex = textureLoader.load('Assets/ground.png');
        groundTex.wrapS = THREE.RepeatWrapping;
        groundTex.wrapT = THREE.RepeatWrapping;
        groundTex.repeat.set(size/5, size/5); 
        
        const groundMat = new THREE.MeshStandardMaterial({ 
            map: groundTex, 
            roughness: 0.9,
            metalness: 0.0,
            color: 0x418a38 // Lush sacred green grass instead of grey
        });
        
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Central Village Setup Area (Dirt Plateau)
        const dirtCircleGeo = new THREE.CircleGeometry(25, 32);
        const dirtMap = groundTex.clone();
        dirtMap.repeat.set(4, 4);
        const dirtCircleMat = new THREE.MeshStandardMaterial({
            map: dirtMap,
            color: 0x6e4e32, // Brown dirt
            roughness: 1.0,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const dirtCircle = new THREE.Mesh(dirtCircleGeo, dirtCircleMat);
        dirtCircle.rotation.x = -Math.PI / 2;
        dirtCircle.position.set(this.TIPI_X, this.getGroundY(this.TIPI_X, this.TIPI_Z) + 0.05, this.TIPI_Z);
        dirtCircle.receiveShadow = true;
        this.scene.add(dirtCircle);
    }

    async plantSacredForest() {
        const gltfLoader = new GLTFLoader();
        
        return new Promise((resolve) => {
            gltfLoader.load('Assets/tree.glb', (gltf) => {
                const template = gltf.scene;

                // Measure size
                const origBox = new THREE.Box3().setFromObject(template);
                const origSize = new THREE.Vector3();
                origBox.getSize(origSize);

                const treePositions = [];

                // Tipi surroundings
                for (let i = 0; i < 3; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 7.0 + Math.random() * 3.0;
                    treePositions.push({
                        x: this.TIPI_X + Math.cos(angle) * r,
                        z: this.TIPI_Z + Math.sin(angle) * r,
                        scale: 0.8 + Math.random() * 0.5
                    });
                }

                // Inner protection ring
                for (let i = 0; i < 40; i++) {
                    const angle = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
                    const r = 31 + Math.random() * 5;
                    treePositions.push({
                        x: Math.cos(angle) * r,
                        z: Math.sin(angle) * r,
                        scale: 0.9 + Math.random() * 0.8
                    });
                }

                // Main outer forest
                for (let i = 0; i < 100; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 40 + Math.random() * 50;
                    treePositions.push({
                        x: Math.cos(angle) * r,
                        z: Math.sin(angle) * r,
                        scale: 0.6 + Math.random() * 0.6
                    });
                }

                const foliageColors = [
                    new THREE.Color(0x7CFC00), new THREE.Color(0x98FB98), 
                    new THREE.Color(0x87CEFA), new THREE.Color(0x32CD32), 
                    new THREE.Color(0xFF8C00), new THREE.Color(0xDAA520)
                ];

                const meshesToInstance = [];
                template.traverse(child => {
                    if (child.isMesh || child.type === 'Mesh') meshesToInstance.push(child);
                });

                if (meshesToInstance.length > 0) {
                    const matrix = new THREE.Matrix4();
                    const position = new THREE.Vector3();
                    const rotation = new THREE.Euler();
                    const quaternion = new THREE.Quaternion();
                    const sc = new THREE.Vector3();

                    meshesToInstance.forEach((mesh) => {
                        let material = null;
                        if (Array.isArray(mesh.material)) {
                            material = mesh.material[0].clone();
                        } else if (mesh.material) {
                            material = mesh.material.clone();
                        } else {
                            material = new THREE.MeshStandardMaterial({color: 0xffffff});
                        }
                        material.roughness = 1.0;
                        material.metalness = 0.0;
                        
                        const isLeaf = material.name && (material.name.toLowerCase().includes('leaf') || material.name.toLowerCase().includes('foliage'));
                        
                        if (isLeaf) {
                            material.color.setHex(0xffffff);
                        }

                        material.onBeforeCompile = (shader) => {
                            shader.uniforms.uTime = this.globalTime;
                            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\n');
                            
                            if (isLeaf) {
                                let vertexLogic = `
                                #include <begin_vertex>
                                float heightFactor = smoothstep(2.0, 6.0, position.y);
                                float worldX = instanceMatrix[3][0];
                                float worldZ = instanceMatrix[3][2];
                                float phase = (worldX * 0.1) + (worldZ * 0.1);
                                float windStr = 0.16;
                                transformed.x += sin(uTime * 1.5 + phase) * windStr * heightFactor;
                                transformed.z += cos(uTime * 1.2 + phase) * windStr * heightFactor;
                                `;
                                shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', vertexLogic);
                            }
                        };

                        const instancedMesh = new THREE.InstancedMesh(mesh.geometry, material, treePositions.length);
                        instancedMesh.castShadow = true;
                        instancedMesh.receiveShadow = !isLeaf; // Major performance fix!
                        // Force creation of instanceColor regardless or setColorAt will crash it if not called
                        if (!isLeaf) {
                            // Tree logs need the buffer too so instanceColor.needsUpdate doesn't throw if we broadly apply it
                            instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(treePositions.length * 3), 3);
                        }
                        
                        this.instancedMeshes.push({ instancedMesh, isLeaf });
                        this.scene.add(instancedMesh);
                    });

                    for (let idx = 0; idx < treePositions.length; idx++) {
                        const pos = treePositions[idx];
                        const targetH = (8 + Math.random() * 8) * pos.scale;
                        const sf = targetH / Math.max(origSize.y, 0.1);

                        sc.set(sf * 0.9, sf, sf * 0.9);
                        const groundY = this.getGroundY(pos.x, pos.z);
                        position.set(pos.x, groundY, pos.z);
                        rotation.set(0, Math.random() * Math.PI * 2, 0);
                        quaternion.setFromEuler(rotation);

                        matrix.compose(position, quaternion, sc);
                        const tintColor = foliageColors[Math.floor(Math.random() * foliageColors.length)];

                        // Populate logical array
                        this.allTrees.push({
                            position: new THREE.Vector3(pos.x, groundY, pos.z),
                            isInstanced: true,
                            index: idx
                        });

                        this.instancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                            instancedMesh.setMatrixAt(idx, matrix);
                            if (isLeaf) {
                                instancedMesh.setColorAt(idx, tintColor);
                            }
                        });
                    }

                    this.instancedMeshes.forEach(({ instancedMesh, isLeaf }) => {
                        instancedMesh.instanceMatrix.needsUpdate = true;
                        if (isLeaf) instancedMesh.instanceColor.needsUpdate = true;
                    });
                    
                    // Generate dirt root patches under every tree 
                    const dirtRingGeo = new THREE.CircleGeometry(1.8, 12);
                    const dirtRingMat = new THREE.MeshBasicMaterial({
                        color: 0x3d2b1f, // Deep dark soil
                        transparent: true,
                        opacity: 0.75,
                        polygonOffset: true,
                        polygonOffsetFactor: -2,
                        polygonOffsetUnits: -2
                    });
                    const dirtInstanced = new THREE.InstancedMesh(dirtRingGeo, dirtRingMat, treePositions.length);
                    const ringMatrix = new THREE.Matrix4();
                    const ringPos = new THREE.Vector3();
                    const ringRot = new THREE.Euler(-Math.PI / 2, 0, 0);
                    const ringQuat = new THREE.Quaternion().setFromEuler(ringRot);
                    const ringScale = new THREE.Vector3(1, 1, 1);
                    
                    for (let idx = 0; idx < treePositions.length; idx++) {
                        const pos = treePositions[idx];
                        ringPos.set(pos.x, this.getGroundY(pos.x, pos.z) + 0.02, pos.z);
                        ringScale.set(pos.scale * 1.5, pos.scale * 1.5, 1);
                        ringMatrix.compose(ringPos, ringQuat, ringScale);
                        dirtInstanced.setMatrixAt(idx, ringMatrix);
                    }
                    this.scene.add(dirtInstanced);
                }
                // Add bushes
                const bushLoader = new GLTFLoader();
                bushLoader.load('Assets/bush.glb', (bushGltf) => {
                    const bushTemplate = bushGltf.scene;
                    const bBox = new THREE.Box3().setFromObject(bushTemplate);
                    const bSize = bBox.getSize(new THREE.Vector3());
                    const bMax = Math.max(bSize.x, bSize.y, bSize.z);
                    const templateScale = 1.92 / Math.max(bMax, 0.1);
                    
                    const meshArr = [];
                    bushTemplate.traverse(c => { if(c.isMesh) meshArr.push(c); });
                    if (meshArr.length === 0) { resolve(); return; }
                    
                    const bMesh = meshArr[0];
                    const baseMat = new THREE.MeshStandardMaterial({ 
                        color: 0xffffff, // White to allow instanced color tinting
                        roughness: 1.0 
                    });
                    
                    const bushCount = 90;
                    const bushInstanced = new THREE.InstancedMesh(bMesh.geometry, baseMat, bushCount);
                    bushInstanced.castShadow = true;
                    bushInstanced.receiveShadow = false; // Prevents self-shadow CPU overhead
                    
                    const organicTones = [
                        new THREE.Color(0x6b8e23), // OliveDrab
                        new THREE.Color(0x556b2f), // DarkOliveGreen
                        new THREE.Color(0x8b4513), // SaddleBrown
                        new THREE.Color(0x8fbc8f)  // DarkSeaGreen
                    ];
                    
                    const mMat = new THREE.Matrix4();
                    const mPos = new THREE.Vector3();
                    const mQuat = new THREE.Quaternion();
                    const mSca = new THREE.Vector3(1,1,1);
                    
                    for(let i = 0; i < bushCount; i++) {
                        const baseTree = treePositions[Math.floor(Math.random() * treePositions.length)];
                        mPos.x = baseTree.x + (Math.random() - 0.5) * 4;
                        mPos.z = baseTree.z + (Math.random() - 0.5) * 4;
                        mPos.y = this.getGroundY(mPos.x, mPos.z) + 0.1;
                        
                        mQuat.setFromAxisAngle(new THREE.Vector3(0,1,0), Math.random() * Math.PI * 2);
                        const s = (0.8 + Math.random() * 0.5) * templateScale;
                        mSca.set(s, s, s);
                        
                        mMat.compose(mPos, mQuat, mSca);
                        bushInstanced.setMatrixAt(i, mMat);
                        bushInstanced.setColorAt(i, organicTones[Math.floor(Math.random() * organicTones.length)]);
                    }
                    
                    bushInstanced.instanceMatrix.needsUpdate = true;
                    bushInstanced.instanceColor.needsUpdate = true;
                    
                    this.scene.add(bushInstanced);
                    resolve();
                });
            });
        });
    }

    update(delta, camera) {
        this.globalTime.value += delta;
        // MapView logic cutout can be synced here if needed
    }
}
