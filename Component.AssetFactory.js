/**
 * Component.AssetFactory.NextGen.js
 * High-Fidelity Asset Generation using    // Use global THREE
 */

class AssetFactoryNextGen {
    constructor(loadingManager) {
        this.geometries = {};
        this.materials = {};
        this.textures = {};
        this.loader = new THREE.TextureLoader(loadingManager);
        
        // 3DS tree data (loaded async)
        this.treeLoaded = false;
        this.treeTrunkGeo = null;
        this.treeLeafGeo = null;
        this.windMat = null;
        this.treeMeshes = []; // Track all tree groups for wind updates
        
        this.initTextures();
        this.initMaterials();
        this.initGeometries();
        this.treeReady = Promise.resolve();
        
        // Advanced Geometry Cache for "Beautiful Graphics" (Ponderosa Pine)
        this.sharedPines = {
            trunk: null,
            branches: {}, // Keyed by branch length
            foliage: {}   // Keyed by foliage mass radius
        };
    }

    initTextures() {
        const loadTex = (path, repeat = 1) => {
            const t = this.loader.load(path);
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeat, repeat);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };

        // --- TEXTURE GENERATION (Game Dev Standard) ---
        const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        this.textures.bark = loadTex('Assets/bark.png', 2);
        this.textures.rock = loadTex('Assets/rock.png', 4);
        this.textures.water = loadTex('Assets/water.png', 4);
        this.textures.ground = this.generateNoiseTexture(); // Procedural Ground
        this.textures.foliage = this.generateFoliageTexture();
    }
    
    generateFoliageTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // 1. GRASS BLADE (Left Half)
        ctx.fillStyle = '#000000'; // Transparent base
        ctx.fillRect(0,0,512,512);
        
        // Draw Grass Blades (Alpha Mask style)
        // We draw white shapes on black, use as AlphaMap
        // Actually for simplicity, we draw COLORED grass with Alpha
        
        ctx.clearRect(0,0,512,512);
        
        // Draw many blades
        for(let i=0; i<40; i++) {
            // HSL: 95-135 (Greener, less yellow/brown)
            ctx.fillStyle = `hsl(${95 + Math.random()*40}, ${60+Math.random()*20}%, ${35+Math.random()*30}%)`;
            
            const x = Math.random() * 256;      // Left half only for grass
            const w = 10 + Math.random() * 20;
            const h = 200 + Math.random() * 300;
            const bend = (Math.random()-0.5) * 50;
            
            ctx.beginPath();
            ctx.moveTo(x - w/2, 512);
            ctx.quadraticCurveTo(x + bend, 512 - h/2, x, 512 - h); // Tip
            ctx.quadraticCurveTo(x - bend, 512 - h/2, x + w/2, 512); // Base
            ctx.fill();
        }
        
        // 2. BUSH CLUMP (Right Half)
        // Draw a "cloud" of leaves
        const cx = 384; 
        const cy = 256;
        for(let i=0; i<100; i++) {
             ctx.fillStyle = `hsl(${90 + Math.random()*30}, ${50+Math.random()*20}%, ${25+Math.random()*25}%)`;
             
             const r = Math.random() * 40 + 10;
             const ox = (Math.random()-0.5) * 200;
             const oy = (Math.random()-0.5) * 200;
             
             // Keep in circle
             if(ox*ox + oy*oy > 100*100) continue;
             
             ctx.beginPath();
             ctx.arc(cx + ox, cy + oy, r, 0, Math.PI*2);
             ctx.fill();
             ctx.beginPath();
             ctx.arc(cx + ox, cy + oy, r, 0, Math.PI*2);
             ctx.fill();
        }

        // 3. PINE BRANCH (Bottom Half)
        // Need specific needle texture for pine trees
        const px = 256; 
        const py = 384; // Center of bottom half
        
        ctx.fillStyle = '#207026'; // Brighter Pine Green (20% above #1b5e20)
        for(let i=0; i<60; i++) {
            // Needles radiating from center
            const angle = Math.random() * Math.PI * 2;
            const len = 40 + Math.random() * 80;
            const w = 2 + Math.random() * 2;
            
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            ctx.fillRect(0, -w/2, len, w);
            ctx.restore();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    generateNoiseTexture() {
        // Photorealistic grass texture
        const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const tex = this.loadTex(`${baseHref}/Assets/grass_seamless.png`, 1);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(20, 20);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Max anisotropic filtering — smooths texture at oblique angles
        tex.anisotropy = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 16;
        return tex;
    }


    initMaterials() {
        // PBR WOOD
        this.materials.wood = new THREE.MeshStandardMaterial({ 
            map: this.textures.bark,
            roughness: 0.9,
            metalness: 0.1,
            color: 0x5d4037 // Darker wood
        });

        // PBR GROUND (Now Grassland)
        // PBR GROUND (Now Grassland with Vertex Colors)
        // PBR GROUND (Now Grassland with Vertex Colors)
        this.materials.ground = new THREE.MeshStandardMaterial({
            map: this.textures.ground,
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0,
            color: 0xffffff
        });

        // ==========================================
        // NEUMORPHIC JIGSAW PUZZLE TILE SHADER
        // Implements a pure optical boundary directly onto the terrain mesh
        // exactly following the window._hexCenters offsets!
        // ==========================================
        this.materials.ground.onBeforeCompile = (shader) => {
            // 1. Pass Interpolated World Position to Fragment Shader
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                '#include <common>\nvarying vec3 vWorldPos;'
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );

            // 2. Perform Hex Math locally against world coordinate
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
                #include <common>
                varying vec3 vWorldPos;

                // Pointy-Topped Hexagon distance function
                // Defines the exact mathematically perfect boundary of a hexagon
                float hexDist(vec2 p) {
                    p = abs(p);
                    // normalize(vec2(1.0, 1.73205)) is the slope of the pointy roof
                    float c = dot(p, normalize(vec2(1.0, 1.73205081)));
                    return max(c, p.x);
                }
                `
            );

            // 3. Inject coloring before the physical lighting calculations
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>

                // Standardized Village Map Variables
                float hexRadius = 6.27; // Increased by 10% (was 5.7)
                float hr3 = hexRadius * 1.73205081; 
                
                // For a pointy-topped grid, the staggered columns form a bounding box of vec2(width, 3 * R)
                vec2 r = vec2(hr3, hexRadius * 3.0); 
                vec2 h = r * 0.5;
                
                // Map Continuous World UV to discrete nearest Grid Center
                vec2 uv = vWorldPos.xz;
                vec2 a = mod(uv, r) - h;
                vec2 b = mod(uv - h, r) - h;
                vec2 localPos = dot(a, a) < dot(b, b) ? a : b;
                
                // Distance to the center of the exact Hexagon we are currently rendering inside
                float dist = hexDist(localPos); 
                
                // The circumradius edge distance of the polygon
                // In local coordinate, the furthest distance is (hr3 * 0.5).
                float maxDist = hr3 * 0.5;
                float edgeDist = maxDist - dist;
                
                // Nuemorphic Shadow & Puzzle Edges
                // Creates a heavily indented jigsaw border that blends perfectly into grass
                
                // Purely Physical Geometry Shadows (No Glowing Lines)
                // We create a deep crevice Ambient Occlusion shadow at the grid line
                if (edgeDist < 0.15) { 
                    // Deep physical crack
                    float crack = smoothstep(0.0, 0.15, edgeDist);
                    diffuseColor.rgb *= (crack * 0.6 + 0.1); 
                } 
                else if (edgeDist >= 0.15 && edgeDist < 0.4) {
                    // Gradual bevel slope rising from the crack
                    float slope = smoothstep(0.15, 0.4, edgeDist);
                    // Slightly darken the slope
                    diffuseColor.rgb *= (slope * 0.3 + 0.7);
                }
                else if (edgeDist >= 0.4 && edgeDist < 0.6) {
                    // Slight inner highlight for the physical lip of the tile
                    float highlight = smoothstep(0.4, 0.6, edgeDist);
                    diffuseColor.rgb *= (1.0 + (1.0 - highlight) * 0.10); 
                }
                
                // Enhance the physical shadow depth at the corners where three tiles meet
                float cornerDist = length(localPos);
                if (cornerDist > hexRadius * 0.7) {
                     float cornerDip = smoothstep(hexRadius * 0.7, hexRadius, cornerDist);
                     diffuseColor.rgb *= (1.0 - cornerDip * 0.3);
                }
                `
            );
        };

        // PRODUCERAL ROCK
        this.materials.rock = new THREE.MeshStandardMaterial({
            map: this.textures.rock,
            roughness: 0.8,
            metalness: 0.0,
            normalMap: this.textures.rock,
            color: 0x9e9e9e
        });

        // WATER
        this.materials.water = new THREE.MeshPhysicalMaterial({
            map: this.textures.water,
            transparent: true,
            opacity: 0.8,
            transmission: 0.2,
            roughness: 0.1,
            metalness: 0.1,
            color: 0x81d4fa
        });

        this.materials.leaf = new THREE.MeshStandardMaterial({ 
            map: this.textures.foliage,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            roughness: 0.8
        });
        
        // Setup UV coordinates implies we need geometries to match
    }

    initGeometries() {
        // Higher Res Geometries for "NextGen" look
        this.geometries.stick = new THREE.CylinderGeometry(0.05, 0.05, 3, 8); 
        this.geometries.pole = new THREE.CylinderGeometry(0.1, 0.1, 4, 12);
        
        // --- CROSS-PLANE GEOMETRIES ---
        // 1. GRASS PLANE (Uses Left Half of Texture)
        const grassGeo = new THREE.PlaneGeometry(1.5, 1.5);
        // Correct UVs to Left Half (0.0 - 0.5 u)
        const uv = grassGeo.attributes.uv;
        for(let i=0; i<uv.count; i++) {
            uv.setX(i, uv.getX(i) * 0.5);
        }
        grassGeo.translate(0, 0.75, 0); // Pivot at bottom
        this.geometries.grass_plane = grassGeo;
        
        // 2. BUSH PLANE (Uses Right Half of Texture)
        const bushGeo = new THREE.PlaneGeometry(2, 2);
        // Correct UVs to Right Half (0.5 - 1.0 u)
        const uv2 = bushGeo.attributes.uv;
        for(let i=0; i<uv2.count; i++) {
            uv2.setX(i, 0.5 + uv2.getX(i) * 0.5);
        }
        this.geometries.bush_plane = bushGeo;

        // 3. PINE BRANCH PLANE (Bottom Half)
        const pineGeo = new THREE.PlaneGeometry(2.5, 2.5);
        const uv3 = pineGeo.attributes.uv;
        for(let i=0; i<uv3.count; i++) {
             // Map to Bottom Half (0.0-1.0 u, 0.0-0.5 v is taken by top? Wait.)
             // Canvas: 
             // Top-Left: Grass (0-256 x, 0-512 y -- Wait, generateFoliage used full height)
             // Let's re-map logic.
             // generateFoliageTexture logic was:
             // 1. Grass: Left Half (0-256 x, Full Height?) - Draw commands used 512 height logic.
             // 2. Bush: Right Half? cx=384 (which is 256+128).
             
             // Let's refine UVs.
             // Grass (Left Half): u * 0.5
             // Bush (Right Half): 0.5 + u * 0.5
             
             // I added PINE at Bottom Half? That overlaps.
             // Let's put Pine in the Center-Bottom of the texture.
             // Actually, simplest is to just reuse Bush texture for Pine but scale it differently?
             // No, user said "Jurassic", likely means "Spiky". Pine needs to be fluffy.
             // Let's use the Bush texture for Pine branches for now, it works well for "fluffy" pine.
             uv3.setX(i, 0.5 + uv3.getX(i) * 0.5); // Reuse Bush texture section (Right Half)
        }
        pineGeo.translate(1.0, 0, 0); // Pivot at Left Edge (attach to trunk)
        this.geometries.pine_branch = pineGeo;
    }

    create(type) {
        const group = new THREE.Group();
        group.userData.type = type;

        switch (type) {
            case 'tree_pine': this.buildHighResPine(group); break;
            case 'bush_berry': this.buildBush(group); break;
            case 'grass_tuft': this.buildGrassTuft(group); break;
            case 'rock_granite': this.buildHighResRock(group); break;
            case 'cloud_puff': this.buildCloud(group); break;
            case 'ground_chunk': return this.buildGroundChunk(); 
            default: break;
        }

        // Shadow Config (Clouds cast shadows too)
        group.traverse(obj => {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });

        return group;
    }

    // --- BUILDERS ---

    // --- BUILDERS ---
    
    buildHighResPine(group) {
        // ==============================================
        // REALISTIC PONDEROSA PINE
        // Organic foliage masses using displaced icosahedrons,
        // tall bark trunk, visible branches, natural greens
        // ==============================================
        
        const TRUNK_HEIGHT = 10;
        const TRUNK_RADIUS_BASE = 0.4;
        const TRUNK_RADIUS_TOP = 0.15;
        
        // --- TRUNK ---
        if (!this.sharedPines.trunk) {
            const trunkGeo = new THREE.CylinderGeometry(
                TRUNK_RADIUS_TOP, TRUNK_RADIUS_BASE, 
                TRUNK_HEIGHT, 8, 8
            );
            const trunkPos = trunkGeo.attributes.position;
            for(let i = 0; i < trunkPos.count; i++) {
                const x = trunkPos.getX(i);
                const y = trunkPos.getY(i);
                const z = trunkPos.getZ(i);
                const noise = Math.sin(y * 8 + x * 5) * 0.02 + Math.cos(y * 3 + z * 7) * 0.01;
                trunkPos.setX(i, x + noise);
                trunkPos.setZ(i, z + noise);
            }
            trunkGeo.computeVertexNormals();
            this.sharedPines.trunk = trunkGeo;
        }
        
        // --- Shared Materials ---
        if (!this.sharedPines.mats) {
            this.sharedPines.mats = {
                trunk: new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 1.0, metalness: 0.0 }),
                branch: new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.9 }),
                foliage: {} // Cache by color
            };
        }
        
        const trunk = new THREE.Mesh(this.sharedPines.trunk, this.sharedPines.mats.trunk);
        trunk.position.y = TRUNK_HEIGHT / 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        group.add(trunk);
        
        // --- BRANCHES ---
        const branches = [
            { y: 6.0, angle: 0.4,  len: 2.8, tilt: 0.6 },
            { y: 7.0, angle: 1.8,  len: 2.2, tilt: 0.45 },
            { y: 7.8, angle: 3.5,  len: 2.5, tilt: 0.5 },
            { y: 8.5, angle: 5.2,  len: 2.0, tilt: 0.4 },
            { y: 9.0, angle: 0.9,  len: 1.8, tilt: 0.35 },
            { y: 9.5, angle: 2.8,  len: 1.5, tilt: 0.3 },
        ];
        
        branches.forEach(b => {
            if (!this.sharedPines.branches[b.len]) {
                const geo = new THREE.CylinderGeometry(0.03, 0.07, b.len, 4);
                geo.translate(0, b.len / 2, 0);
                this.sharedPines.branches[b.len] = geo;
            }
            const branch = new THREE.Mesh(this.sharedPines.branches[b.len], this.sharedPines.mats.branch);
            branch.position.set(0, b.y, 0);
            branch.rotation.z = b.tilt;
            branch.rotation.y = b.angle;
            branch.castShadow = true;
            group.add(branch);
        });
        
        // --- ORGANIC FOLIAGE MASSES ---
        const createFoliageMass = (x, y, z, radius, color) => {
            if (!this.sharedPines.foliage[radius]) {
                const detail = 2; 
                const geo = new THREE.IcosahedronGeometry(radius, detail);
                
                const pos = geo.attributes.position;
                for(let i = 0; i < pos.count; i++) {
                    const vx = pos.getX(i);
                    const vy = pos.getY(i);
                    const vz = pos.getZ(i);
                    
                    const n1 = Math.sin(vx * 3.7 + vy * 2.1) * Math.cos(vz * 4.3) * 0.25;
                    const n2 = Math.sin(vx * 7.1 + vz * 5.3) * 0.12;
                    const n3 = (Math.random() - 0.5) * 0.08;
                    const displacement = 1.0 + n1 + n2 + n3;
                    
                    pos.setX(i, vx * displacement);
                    pos.setY(i, vy * displacement * 0.75);
                    pos.setZ(i, vz * displacement);
                }
                geo.computeVertexNormals();
                this.sharedPines.foliage[radius] = geo;
            }
            
            if (!this.sharedPines.mats.foliage[color]) {
                this.sharedPines.mats.foliage[color] = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.95,
                    metalness: 0.0,
                    flatShading: false
                });
            }
            
            const mesh = new THREE.Mesh(this.sharedPines.foliage[radius], this.sharedPines.mats.foliage[color]);
            mesh.position.set(x, y, z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        };
        
        // Random jitter for organic placement
        const jx = () => (Math.random() - 0.5) * 0.5;
        const jz = () => (Math.random() - 0.5) * 0.5;
        
        // UPPER CROWN — main mass (Ponderosa: foliage top-heavy)
        createFoliageMass(0 + jx(),    11.0, 0 + jz(),    1.8, 0x37963C);   // Big center
        createFoliageMass(1.3 + jx(),  10.5, 0.5 + jz(),  1.3, 0x207026);   // Right
        createFoliageMass(-1.1 + jx(), 10.7, -0.3 + jz(), 1.2, 0x43AA48);   // Left
        createFoliageMass(0.2 + jx(),  10.0, -1.2 + jz(), 1.4, 0x37963C);   // Back
        createFoliageMass(-0.3 + jx(), 11.8, 0.4 + jz(),  1.0, 0x50C055);   // Top cap
        
        // MID-LEVEL — sparse arms reaching out  
        createFoliageMass(2.0 + jx(),  8.5, 0.3 + jz(),   1.0, 0x207026);   // Far right
        createFoliageMass(-1.8 + jx(), 8.0, 0.7 + jz(),   0.9, 0x3D7E24);   // Far left
        createFoliageMass(0.4 + jx(),  8.3, -1.8 + jz(),  1.1, 0x37963C);   // Back arm
        
        this.treeMeshes.push(group);
    }
    
    // Load 3DS pine tree model (Obsolete, resolved instantly)
    loadTree3DS() {
        return Promise.resolve();
    }
    
    // Branch material — uses branch2.png texture, clean (no sway warping)
    createWindMaterial() {
        const branchTex = this.loadTex('Assets/PineTree/branch2.png', 1);
        const mat = new THREE.MeshStandardMaterial({
            map: branchTex,
            roughness: 0.8,
            side: THREE.DoubleSide,
            alphaTest: 0.5
        });
        return mat;
    }
    
    // Helper to load textures externally
    loadTex(path, repeat = 1) {
        const t = this.loader.load(path);
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }
    
    // Call this each frame from the animate loop to drive wind
    updateWind(time) {
        if(this.windMat && this.windMat.userData.shader) {
            this.windMat.userData.shader.uniforms.windTime.value = time;
        }
    }

    buildBush(group) {
        // Realistic Billboard Bush
        // 3 Intersecting planes with leaf texture
        const count = 3;
        const mat = this.materials.leaf;
        
        for(let i=0; i<count; i++) {
            const mesh = new THREE.Mesh(this.geometries.bush_plane, mat);
            mesh.rotation.y = (i / count) * Math.PI;
            mesh.position.y = 0.8; // Lift
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        }
    }

    buildCloud(group) {
        // Artistic Low Poly Clouds (Clusters of White Cubes/Dodecas)
        const puffCount = 3 + Math.floor(Math.random() * 4);
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 0.3, 
            flatShading: true,
            emissive: 0xffffff,
            emissiveIntensity: 0.1
        });
        
        for(let i=0; i<puffCount; i++) {
            const geo = new THREE.DodecahedronGeometry(2 + Math.random(), 0);
            const mesh = new THREE.Mesh(geo, mat);
            
            mesh.position.set(
                (Math.random()-0.5) * 4, 
                (Math.random()-0.5) * 1.5, 
                (Math.random()-0.5) * 2
            );
            
            mesh.scale.setScalar(1 + Math.random() * 0.5);
            mesh.rotation.set(Math.random(), Math.random(), Math.random());
            
            group.add(mesh);
        }
        group.position.y = 20 + Math.random() * 10; // High up default
    }

    buildGrassTuft(group) {
        // Game Spec Grass: Cross Panels
        // Scale DOWN significantly to avoid "Spike" look
        const mat = this.materials.leaf;
        const count = 3; 
        for(let i=0; i<count; i++) {
            const mesh = new THREE.Mesh(this.geometries.grass_plane, mat);
            mesh.rotation.y = (i / count) * Math.PI + Math.random();
            mesh.scale.setScalar(0.5); // Smaller grass
            group.add(mesh);
        }
    }

    buildHighResRock(group) {
         // REPLACED ROCKS WITH FERN BRUSH (User Request)
         // "Fern" - clusters of green planes
         const mat = this.materials.leaf;
         const count = 5;
         
         for(let i=0; i<count; i++) {
             // Re-using grass plane but scaled up
             const fern = new THREE.Mesh(this.geometries.grass_plane, mat);
             fern.scale.set(1.5, 1.2, 1.5);
             fern.rotation.y = (i/count) * Math.PI + Math.random();
             fern.rotation.x = -0.2; // Angle out
             fern.position.y = 0;
             group.add(fern);
         }
    }

    buildGroundChunk() {
        const geo = new THREE.PlaneGeometry(60*4, 60*4, 128, 128); 
        geo.rotateX(-Math.PI/2);
        
        const count = geo.attributes.position.count;
        const colors = [];
        
        // Randomize height & apply smooth vertex color variation
        // MATCHES getGroundY in SacredGame.html — tipi-centric terrain
        const terrainY = (gx, gz) => {
            const TIPI_X = 0, TIPI_Z = 0;
            const CLEARING_R = 30;
            const HILL_INNER = 30;
            const HILL_OUTER = 60;
            const HILL_HEIGHT = 4.0;

            let baseNoise = Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5 + Math.sin(gx * 0.2 + gz * 0.15) * 0.4;
            let y = baseNoise;
            const dx = gx - TIPI_X, dz = gz - TIPI_Z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist < CLEARING_R) {
                if (dist < 8) {
                    y = 0; // Purely flat base for Tipi footprint
                } else {
                    const t = (dist - 8) / (CLEARING_R - 8);
                    const flatten = 0.5 + 0.5 * Math.cos(t * Math.PI);
                    y = baseNoise * (1.0 - flatten);
                }
            }

            if (dist >= HILL_INNER && dist < HILL_OUTER) {
                const t = (dist - HILL_INNER) / (HILL_OUTER - HILL_INNER);
                const hillShape = Math.sin(t * Math.PI);
                const angle = Math.atan2(dz, dx);
                const noise = 0.65 + 0.35 * Math.sin(angle * 3 + 0.8) * Math.sin(angle * 5 + 2.1) * 0.3;
                const lobe = 0.7 + 0.3 * Math.sin(angle * 2.3 + 1.2);
                y += HILL_HEIGHT * hillShape * (noise + 0.5) * lobe;
            }

            if (dist > HILL_OUTER) {
                const outerBlend = Math.min(1.0, (dist - HILL_OUTER) / 10);
                const rollingH = Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.5 + Math.sin(gx * 0.12 + gz * 0.1) * 1.0;
                y += rollingH * outerBlend;
            }

            // Mystical Island Radial Drop-Off (replaces square edge flattening)
            // 'dist' is already computed from the center (TIPI_X=0)
            if (dist > 100) {
                // Smooth radial drop off forming a magical floating island
                const dropT = Math.min(1.0, (dist - 100) / 20.0);
                y = y * (1.0 - dropT) - Math.pow(dropT, 3.0) * 8.0; 
            }
            
            return y;
        };
        
        const pos = geo.attributes.position;
        for (let i = 0; i < count; i++) {
             const x = pos.getX(i);
             const z = pos.getZ(i);
             pos.setY(i, terrainY(x, z));
             
             // Terrain-aware vertex colors
             const dist = Math.sqrt(x*x + z*z);
             const sc = z*0.6 + Math.sin(x*0.05)*8 + 15;
             const streamD = Math.abs(x - sc);
             
             let r = 0.97 + Math.random() * 0.06;
             let g = r, b = r;
             
             // Streambed: blue-brown tint
             if(streamD < 3 && dist > 26) {
                 const sb = 0.5 + 0.5 * Math.cos(streamD/3*Math.PI);
                 r -= sb * 0.15; g -= sb * 0.05; b += sb * 0.1;
             }
             // Hills: lush green tint
             if(dist >= 16 && dist < 26) {
                 const hb = Math.sin((dist-8)/10*Math.PI);
                 r -= hb * 0.08; g += hb * 0.05; b -= hb * 0.06;
             }
             // Sacred clearing: sandy brown
             if(dist < 8) {
                 const cb = 0.5 + 0.5 * Math.cos(dist/8*Math.PI);
                 r = r * (1-cb) + 0.80 * cb;
                 g = g * (1-cb) + 0.70 * cb;
                 b = b * (1-cb) + 0.48 * cb;
             }
             
             // Edge Fade: Turn it dark near the void edge
             if (dist > 105) {
                 const darkness = Math.min(1.0, (dist - 105) / 15.0);
                 const v = 1.0 - darkness;
                 r *= v; g *= v; b *= v;
             }
             
             colors.push(r, g, b);
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        
        const mesh = new THREE.Mesh(geo, this.materials.ground);
        mesh.receiveShadow = true;
        
        // --- ETHEREAL HAZE OVERLAY ---
        // Semi-transparent green plane that softens the grass tile seams
        const hazeGeo = new THREE.PlaneGeometry(60*4, 60*4, 128, 128);
        hazeGeo.rotateX(-Math.PI/2);
        
        // Match terrain heights + hover slightly above
        const hazePos = hazeGeo.attributes.position;
        for(let i = 0; i < hazePos.count; i++) {
            const hx = hazePos.getX(i);
            const hz = hazePos.getZ(i);
            let hY = terrainY(hx, hz) + 0.15;
            
            // Push haze down into the ground near the Tipi to prevent it clipping the Tipi's floor
            const dist = Math.sqrt(hx*hx + hz*hz);
            if (dist < 6) {
                hY -= 0.15; // Flatten haze exactly to ground
            } else if (dist < 10) {
                const t = (dist - 6) / 4;
                hY -= 0.15 * (1 - t);
            }
            
            hazePos.setY(i, hY);
        }
        hazeGeo.computeVertexNormals();
        
        const hazeMat = new THREE.MeshBasicMaterial({
            color: 0x2d5a1e,        // Soft dark green
            transparent: true,
            opacity: 0.12,           // Very subtle
            depthWrite: false,       // Don't occlude grass underneath
            side: THREE.FrontSide
        });
        const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
        
        const group = new THREE.Group();
        group.add(mesh);
        group.add(hazeMesh);
        return group;
    }

    tintTerrain(meshOrGroup, cx, cz, radius, colorHex) {
        // Handle Group (buildGroundChunk now returns Group with ground + haze overlay)
        let mesh = meshOrGroup;
        if(!mesh.geometry) {
            // It's a Group — find the first child mesh with vertex colors
            mesh.traverse(child => {
                if(child.isMesh && child.geometry && child.geometry.attributes.color) {
                    mesh = child;
                }
            });
        }
        if(!mesh.geometry || !mesh.geometry.attributes.color) return;
        
        const pos = mesh.geometry.attributes.position;
        const cols = mesh.geometry.attributes.color;
        const targetColor = new THREE.Color(colorHex);
        const count = pos.count;
        
        // Brute force distance check (Optimization: Map grid to indices, but for 128x128 it's ~16k verts, fast enough for init)
        for(let i=0; i<count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            
            const dx = x - cx;
            const dz = z - cz;
            const distSq = dx*dx + dz*dz;
            const rSq = radius*radius;
            
            if(distSq < rSq) {
                // Blend
                const falloff = 1.0 - (distSq / rSq); // 1 at center, 0 at edge
                
                const curR = cols.getX(i);
                const curG = cols.getY(i);
                const curB = cols.getZ(i);
                
                // Mix towards target based on falloff strength
                cols.setXYZ(i, 
                    THREE.MathUtils.lerp(curR, targetColor.r, falloff * 0.8),
                    THREE.MathUtils.lerp(curG, targetColor.g, falloff * 0.8),
                    THREE.MathUtils.lerp(curB, targetColor.b, falloff * 0.8)
                );
            }
        }
        cols.needsUpdate = true;
    }
}

if(typeof window !== 'undefined') {
    window.AssetFactoryNextGen = AssetFactoryNextGen;
}
