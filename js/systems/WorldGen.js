import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { BufferGeometryUtils } from 'https://unpkg.com/three@0.128.0/examples/jsm/utils/BufferGeometryUtils.js';
import { 
    TILE_SIZE, MAP_SIZE, T_GRASS, T_FOREST, T_CORN, T_WATER, T_SHRUB, T_PATH, T_ROCK 
} from '../Constants.js';

export class WorldGen {
    constructor(engine) {
        this.engine = engine;
        this.scene = engine.scene;
    }

    generateWilderness() {
        // Initialize map with grass
        this.engine.map = [];
        for (let y = 0; y < MAP_SIZE; y++) {
            this.engine.map[y] = new Array(MAP_SIZE).fill(T_GRASS);
        }

        // Generate Forest
        const seed = Math.random() * 100;
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const nx = x * 0.15;
                const ny = y * 0.15;
                const val = Math.sin(nx + seed) * Math.cos(ny - seed) + Math.sin(nx * 2 + ny * 2) * 0.5;
                if (val > 0.4) this.engine.map[y][x] = T_FOREST;
            }
        }

        // River Generation
        const curvePoints = [];
        let cx = Math.random() * MAP_SIZE;
        for (let i = 0; i < 8; i++) {
            curvePoints.push(new THREE.Vector3(cx, 0, (i / 7) * MAP_SIZE));
            cx += (Math.random() - 0.5) * 30;
            cx = Math.max(5, Math.min(MAP_SIZE - 5, cx));
        }
        const curve = new THREE.CatmullRomCurve3(curvePoints);
        const points = curve.getPoints(200);
        points.forEach(p => {
            const gx = Math.floor(p.x);
            const gy = Math.floor(p.z);
            if (gx >= 0 && gx < MAP_SIZE && gy >= 0 && gy < MAP_SIZE) {
                this.engine.map[gy][gx] = T_WATER;
                if (this.engine.map[gy][gx + 1] !== undefined) this.engine.map[gy][gx + 1] = T_WATER;
                if (this.engine.map[gy + 1] && this.engine.map[gy + 1][gx] !== undefined) this.engine.map[gy + 1][gx] = T_WATER;
            }
        });

        // Path Generation
        for (let k = 0; k < 2; k++) {
            const pPoints = [];
            let px = Math.random() * MAP_SIZE;
            let py = Math.random() * MAP_SIZE;
            for (let i = 0; i < 6; i++) {
                pPoints.push(new THREE.Vector3(px, 0, py));
                px += (Math.random() - 0.5) * 40;
                py += (Math.random() - 0.5) * 40;
            }
            const pCurve = new THREE.CatmullRomCurve3(pPoints);
            const pathPts = pCurve.getPoints(150);
            pathPts.forEach(p => {
                const gx = Math.floor(p.x);
                const gy = Math.floor(p.z);
                if (gx >= 0 && gx < MAP_SIZE && gy >= 0 && gy < MAP_SIZE) {
                    if (this.engine.map[gy][gx] !== T_WATER) this.engine.map[gy][gx] = T_PATH;
                }
            });
        }

        // Clear player spawn area
        this.engine.player.x = MAP_SIZE / 2;
        this.engine.player.y = MAP_SIZE / 2;
        for (let y = Math.floor(this.engine.player.y) - 2; y <= Math.floor(this.engine.player.y) + 2; y++) {
            for (let x = Math.floor(this.engine.player.x) - 2; x <= Math.floor(this.engine.player.x) + 2; x++) {
                this.engine.map[y][x] = T_GRASS;
            }
        }

        this.buildWorldMesh();
        // Removed spawnAnimals
        this.spawn3DLoot();
        this.spawnCards();
    }

    buildWorldMesh() {
        const floorGeoms = [], pathGeoms = [];
        const matGrass = new THREE.MeshStandardMaterial({ color: 0x556B2F, roughness: 1.0 });
        const matPath = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 1.0 });
        const matWater = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.85 });
        const matRock = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });

        const dummy = new THREE.Object3D();
        let treeCount = 0;
        const map = this.engine.map;

        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const type = map[y][x];
                const posX = (x - MAP_SIZE / 2) * TILE_SIZE;
                const posZ = (y - MAP_SIZE / 2) * TILE_SIZE;

                if (type === T_WATER) {
                    const w = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
                    w.rotateX(-Math.PI / 2);
                    w.translate(posX, -0.2, posZ);
                    const m = new THREE.Mesh(w, matWater);
                    this.scene.add(m);
                } else {
                    const g = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
                    g.rotateX(-Math.PI / 2);
                    g.translate(posX, 0, posZ);
                    if (type === T_PATH) pathGeoms.push(g);
                    else floorGeoms.push(g);
                }

                if (type === T_FOREST) treeCount++;
                if (type === T_SHRUB) {
                    if (Math.random() < 0.3) {
                        const r = new THREE.DodecahedronGeometry(TILE_SIZE * 0.3);
                        r.translate(posX, 0.3, posZ);
                        const rm = new THREE.Mesh(r, matRock);
                        rm.castShadow = true; this.scene.add(rm);
                    } else {
                        const s = new THREE.DodecahedronGeometry(TILE_SIZE * 0.2);
                        s.translate(posX, 0.4, posZ);
                        const sm = new THREE.Mesh(s, matGrass);
                        sm.castShadow = true; this.scene.add(sm);
                    }
                }
            }
        }

        if (floorGeoms.length) {
            const m = new THREE.Mesh(BufferGeometryUtils.mergeBufferGeometries(floorGeoms), matGrass);
            m.receiveShadow = true; this.scene.add(m);
        }
        if (pathGeoms.length) {
            const m = new THREE.Mesh(BufferGeometryUtils.mergeBufferGeometries(pathGeoms), matPath);
            m.receiveShadow = true; this.scene.add(m);
        }

        if (treeCount > 0) {
            const trunk = new THREE.CylinderGeometry(0.3, 0.5, 2, 6); trunk.translate(0, 1, 0);
            const foliage = new THREE.ConeGeometry(2.2, 5, 7); foliage.translate(0, 4, 0);
            const matBark = new THREE.MeshStandardMaterial({ color: 0x3e2723 });
            const matLeaf = new THREE.MeshStandardMaterial({ color: 0x14532d });

            const meshTrunk = new THREE.InstancedMesh(trunk, matBark, treeCount);
            const meshFoliage = new THREE.InstancedMesh(foliage, matLeaf, treeCount);
            meshTrunk.castShadow = true; meshFoliage.castShadow = true;

            let idx = 0;
            for (let y = 0; y < MAP_SIZE; y++) {
                for (let x = 0; x < MAP_SIZE; x++) {
                    if (map[y][x] === T_FOREST) {
                        const posX = (x - MAP_SIZE / 2) * TILE_SIZE;
                        const posZ = (y - MAP_SIZE / 2) * TILE_SIZE;
                        dummy.position.set(posX + (Math.random() - 0.5), 0, posZ + (Math.random() - 0.5));
                        const s = 0.8 + Math.random() * 0.8;
                        dummy.scale.set(s, s + Math.random() * 0.5, s);
                        dummy.updateMatrix();
                        meshTrunk.setMatrixAt(idx, dummy.matrix);
                        meshFoliage.setMatrixAt(idx, dummy.matrix);
                        idx++;
                    }
                }
            }
            this.scene.add(meshTrunk); this.scene.add(meshFoliage);
        }
    }

    // Removed animal generation methods

    spawnNPC(geo, mat, name, targetX, targetY) {
        const group = new THREE.Group();
        const person = new THREE.Mesh(geo, mat);
        person.castShadow = true;
        group.add(person);

        const mule = this.createMuleVisuals();
        mule.position.set(-1.5, 0, -1);
        mule.rotation.y = 0.5;
        group.add(mule);

        let px, pz;
        let gridX, gridY;

        if (targetX !== undefined && targetY !== undefined) {
            gridX = targetX;
            gridY = targetY;
        } else {
            do {
                gridX = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
                gridY = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
            } while (this.engine.map[gridY][gridX] !== T_GRASS);
        }

        px = (gridX - MAP_SIZE / 2) * TILE_SIZE;
        pz = (gridY - MAP_SIZE / 2) * TILE_SIZE;

        group.position.set(px, 0.85, pz);
        group.layers.enable(0); group.layers.enable(1);
        this.scene.add(group);

        // Add (*) Marker
        const cvs = document.createElement('canvas'); cvs.width = 128; cvs.height = 128;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#C04E38"; ctx.lineWidth = 8; ctx.stroke();
        ctx.fillStyle = "#1e2610"; ctx.font = "bold 100px Nunito";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("*", 64, 84);

        const tex = new THREE.CanvasTexture(cvs);
        const matSprite = new THREE.SpriteMaterial({ map: tex });

        // Strategy Marker
        const sprite = new THREE.Sprite(matSprite);
        sprite.position.set(0, 15, 0);
        sprite.scale.set(8, 8, 1);
        sprite.layers.set(5);
        group.add(sprite);

        // FPV Marker
        const fpvS = new THREE.Sprite(matSprite);
        fpvS.position.set(0, 4, 0);
        fpvS.scale.set(2, 2, 1);
        group.add(fpvS);

        this.engine.spawnFloatingText(name, "#FFFFFF", group.position);

        this.engine.animals.push({ x: gridX, y: gridY, type: name, mesh: group, encountered: false, isNPC: true });
    }

    spawnCards() {
        const cardGeo = new THREE.BoxGeometry(0.4, 0.6, 0.05);
        const cardMat = new THREE.MeshStandardMaterial({ color: 0x312e81, emissive: 0x1e1b4b });
        for (let i = 0; i < 3; i++) {
            this.spawnLoot(cardGeo, cardMat, 'Spirit Card', T_WATER);
        }
    }

    spawn3DLoot() {
        const flintGeo = new THREE.TetrahedronGeometry(0.2);
        const flintMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
        const cornGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
        const cornMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
        const fishGeo = new THREE.ConeGeometry(0.15, 0.5, 4);
        const fishMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x004466 });

        for (let i = 0; i < 5; i++) this.spawnLoot(flintGeo, flintMat, 'Arrowhead', T_WATER);
        for (let i = 0; i < 8; i++) this.spawnLoot(cornGeo, cornMat, 'Raw Maize', T_WATER);
        for (let i = 0; i < 10; i++) this.spawnFish(fishGeo, fishMat);
    }

    spawnLoot(geo, mat, type, avoidTile) {
        let x, y;
        do {
            x = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
            y = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
        } while (this.engine.map[y][x] === avoidTile);

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((x - MAP_SIZE / 2) * TILE_SIZE, 0.3, (y - MAP_SIZE / 2) * TILE_SIZE);
        mesh.rotation.z = Math.PI / 4;
        mesh.castShadow = true;
        mesh.layers.enable(0); mesh.layers.enable(1);
        this.scene.add(mesh);

        const animateLoot = () => { mesh.rotation.y += 0.02; };
        this.engine.gameObjects.push({ x, y, type, mesh, animate: animateLoot });
    }

    spawnFish(geo, mat) {
        let x, y;
        let attempts = 0;
        do {
            x = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
            y = Math.floor(Math.random() * (MAP_SIZE - 2)) + 1;
            attempts++;
        } while (this.engine.map[y][x] !== T_WATER && attempts < 100);

        if (this.engine.map[y][x] === T_WATER) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set((x - MAP_SIZE / 2) * TILE_SIZE, -0.1, (y - MAP_SIZE / 2) * TILE_SIZE);
            mesh.rotation.x = Math.PI / 2;
            mesh.layers.enable(0); mesh.layers.enable(1);
            this.scene.add(mesh);

            const animateFish = () => {
                mesh.rotation.z += 0.05;
                mesh.position.x += Math.sin(performance.now() * 0.002) * 0.01;
            };
            this.engine.gameObjects.push({ x, y, type: 'fish', mesh, animate: animateFish });
        }
    }

    spawnWoodAndCamps() {
        const woodGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 5);
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
        for (let i = 0; i < 15; i++) {
            this.spawnItem(woodGeo, woodMat, 'wood');
        }
        this.spawnCampMarker(this.engine.player.x + 3, this.engine.player.y + 3);
    }

    spawnItem(geo, mat, type) {
        let x, y;
        do {
            x = Math.floor(Math.random() * (MAP_SIZE - 6)) + 3;
            y = Math.floor(Math.random() * (MAP_SIZE - 6)) + 3;
        } while (this.engine.map[y][x] === T_WATER);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((x - MAP_SIZE / 2) * TILE_SIZE, 0.2, (y - MAP_SIZE / 2) * TILE_SIZE);
        mesh.rotation.z = Math.PI / 2;
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.layers.enable(0); mesh.layers.enable(1);
        this.scene.add(mesh);
        this.engine.gameObjects.push({ x, y, type, mesh });
    }

    spawnCampMarker(tx, ty) {
        if (this.engine.activeCampMarker) {
            this.scene.remove(this.engine.activeCampMarker.mesh);
            if (this.engine.activeCampMarker.firepit) this.scene.remove(this.engine.activeCampMarker.firepit);
            if (this.engine.activeCampMarker.axe) this.scene.remove(this.engine.activeCampMarker.axe);
            if (this.engine.activeCampMarker.ground) this.scene.remove(this.engine.activeCampMarker.ground);
            if (this.engine.activeCampMarker.teepee) this.scene.remove(this.engine.activeCampMarker.teepee);
        }

        const px = (tx - MAP_SIZE / 2) * TILE_SIZE;
        const pz = (ty - MAP_SIZE / 2) * TILE_SIZE;

        // Teepee Visual
        const teepee = this.createTeepeeVisuals();
        teepee.position.set(px, 0, pz);
        this.scene.add(teepee);

        const firepit = this.createFirepitVisuals();
        firepit.position.set(px + 2, 0, pz + 2);
        this.scene.add(firepit);

        const axe = this.createStoneAxeVisuals();
        axe.position.set(px + 1, 0.2, pz + 3);
        axe.rotation.y = Math.random();
        this.scene.add(axe);

        const woodGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 5);
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
        const wx = tx + (Math.random() > 0.5 ? 3 : -3);
        const wy = ty + (Math.random() > 0.5 ? 3 : -3);
        const wMesh = new THREE.Mesh(woodGeo, woodMat);
        wMesh.position.set((wx - MAP_SIZE / 2) * TILE_SIZE, 0.2, (wy - MAP_SIZE / 2) * TILE_SIZE);
        wMesh.layers.enable(0); wMesh.layers.enable(1);
        this.scene.add(wMesh);
        this.engine.gameObjects.push({ x: wx, y: wy, type: 'wood', mesh: wMesh });

        const cvs = document.createElement('canvas'); cvs.width = 128; cvs.height = 128;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#C04E38"; ctx.lineWidth = 8; ctx.stroke();
        ctx.fillStyle = "#1e2610"; ctx.font = "bold 80px Nunito";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", 64, 68);

        const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs) });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(px, 15, pz);
        sprite.scale.set(8, 8, 1);
        sprite.layers.set(5);
        this.scene.add(sprite);

        const squareGeo = new THREE.PlaneGeometry(TILE_SIZE * 2, TILE_SIZE * 2);
        const squareMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
        const groundSquare = new THREE.Mesh(squareGeo, squareMat);
        groundSquare.rotation.x = -Math.PI / 2;
        groundSquare.position.set(px, 0.1, pz);
        this.scene.add(groundSquare);

        this.engine.activeCampMarker = { x: tx, y: ty, mesh: sprite, firepit: firepit, axe: axe, axeTaken: false, ground: groundSquare, teepee: teepee };
        this.engine.timeSinceCamp = 0;
        this.engine.log("You spot a Teepee ahead...", "#facc15");
        this.engine.spawnFloatingText("Camp Found!", "#facc15", this.engine.player.object.position);
    }
}
