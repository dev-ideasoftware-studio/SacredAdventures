class RabbitSystem {
    constructor(scene, player, groundHeightFunc) {
        this.scene = scene;
        this.player = player;
        this.getHeight = groundHeightFunc;
        
        this.rabbits = [];
        this.mothers = [];
        
        // Static burrows/holes around the map near Tipis
        this.burrows = [
            new THREE.Vector3(4, 0, -5),   // Near Tipi 1 (0, 0)
            new THREE.Vector3(-15, 0, 8),  // Near Tipi 3 (-12, 12)
            new THREE.Vector3(25, 0, 25),
            new THREE.Vector3(-20, 0, -20)
        ];
        
        // Config
        this.alertDist = 20.0;
        this.fleeDist = 12.0;
        this.runSpeed = 6.0;
        this.walkSpeed = 1.5;
        this.babySpeed = 2.5; 
        
        // AI States
        this.STATES = {
            IDLE: 0,
            EATING: 1,
            GROOMING: 2,
            WALKING: 3,
            FREEZING: 4,
            FLEEING: 5,
            FLEEING_TO_HOLE: 6,
            HIDDEN: 7,
            PEEK_OUT: 8,
            FOLLOWING_MOM: 9
        };
        
        this.init();
    }
    
    init() {
        const loader = new THREE.OBJLoader();
        loader.load('Assets/Rabbit.obj', (obj) => {
            let mesh = null;
            obj.traverse(c => { if(c.isMesh) mesh = c; });
            if(!mesh) return;
            
            // Natural Colors (Greys/Browns)
            const colors = [0xd2b48c, 0x8b4513, 0x877c74, 0x6e5c54, 0xa0522d];
            
            // 0. Render visual burrows
            const holeGeo = new THREE.CircleGeometry(0.6, 16);
            const holeMat = new THREE.MeshBasicMaterial({ color: 0x110c08, depthWrite: false }); // dark dirt
            this.burrows.forEach(b => {
                const holeMesh = new THREE.Mesh(holeGeo, holeMat);
                holeMesh.rotation.x = -Math.PI / 2;
                b.y = this.getHeight(b.x, b.z);
                holeMesh.position.set(b.x, b.y + 0.05, b.z); // slightly above ground to prevent z-fighting
                this.scene.add(holeMesh);
            });

            // 1. Spawn Family Clusters (Mother + Bunnies) near burrows
            const familyLocations = [
                this.burrows[0], // Near Tipi 1
                this.burrows[1]  // Near Tipi 3
            ];
            
            familyLocations.forEach(loc => {
                const motherColor = colors[Math.floor(Math.random() * colors.length)];
                const mother = this.createRabbit(mesh, 1.0, motherColor, 'MOTHER'); 
                mother.role = 'MOTHER';
                mother.mesh.position.set(loc.x + 2, 0, loc.z + 2); 
                this.mothers.push(mother);
                
                const babyCount = 4 + Math.floor(Math.random() * 2);
                for(let i=0; i<babyCount; i++) {
                    let col = (Math.random() < 0.5) ? motherColor : colors[Math.floor(Math.random() * colors.length)];
                    const baby = this.createRabbit(mesh, 0.4 + Math.random()*0.1, col, 'BUNNY');
                    baby.role = 'BUNNY';
                    baby.mother = mother; 
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 1.0 + Math.random() * 2.0;
                    baby.mesh.position.x = mother.mesh.position.x + Math.sin(angle) * dist;
                    baby.mesh.position.z = mother.mesh.position.z + Math.cos(angle) * dist;
                }
            });
            
            // 2. Spawn Solo Rabbits
            const soloCount = 8;
            for(let i=0; i<soloCount; i++) {
                const col = colors[Math.floor(Math.random() * colors.length)];
                const rabbit = this.createRabbit(mesh, 0.8 + Math.random()*0.2, col, 'RABBIT');
                const rx = (Math.random() - 0.5) * 60;
                const rz = (Math.random() - 0.5) * 60;
                rabbit.mesh.position.set(rx, 0, rz);
            }
        });
    }
    
    createRabbit(meshTemplate, scale, color, name) {
        const mesh = meshTemplate.clone();
        mesh.material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.9 });
        mesh.castShadow = true;
        
        const group = new THREE.Group();
        group.add(mesh);
        mesh.rotation.y = Math.PI; // Correct backwards OBJ
        group.scale.set(scale, scale, scale);
        
        this.scene.add(group);
        
        const rabbit = {
            mesh: group,
            internalMesh: mesh,
            state: this.STATES.IDLE,
            timer: Math.random() * 1.0, // Kid-friendly high frequency
            target: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            role: name,
            baseScale: scale,
            mother: null,
            hopCycle: Math.random(), // 0.0 to 1.0
            holeTarget: null
        };
        
        this.rabbits.push(rabbit);
        return rabbit;
    }
    
    update(delta) {
        for(const r of this.rabbits) {
            this.updateAI(r, delta);
            this.updatePhysics(r, delta);
        }
    }
    
    updateAI(r, delta) {
        if(r.state === this.STATES.HIDDEN) {
            r.timer -= delta;
            if(r.timer <= 0) {
                // Peek out
                r.state = this.STATES.PEEK_OUT;
                r.timer = 2.0 + Math.random() * 2.0;
                r.mesh.visible = true;
                // Place right at the burrow mouth
                r.mesh.position.copy(r.holeTarget);
            }
            return;
        }

        if(r.state === this.STATES.PEEK_OUT) {
            r.timer -= delta;
            // Check if player is still near
            const distToPlayer = r.mesh.position.distanceTo(this.player.position);
            if(distToPlayer < this.fleeDist) {
                // Dive back in
                r.state = this.STATES.HIDDEN;
                r.timer = 5.0 + Math.random() * 5.0; // Hide longer
                r.mesh.visible = false;
            } else if (r.timer <= 0) {
                // Safe to emerge
                r.state = this.STATES.IDLE;
                r.timer = 1.0;
            }
            return;
        }

        const distToPlayer = r.mesh.position.distanceTo(this.player.position);

        // 1. Alert / Freezing Phase
        if(distToPlayer < this.alertDist && distToPlayer >= this.fleeDist) {
            if(r.state !== this.STATES.FREEZING && r.state !== this.STATES.FLEEING_TO_HOLE && r.state !== this.STATES.FLEEING) {
                r.state = this.STATES.FREEZING;
                r.timer = 1.0; // Freeze for 1 second
                // Look at player
                r.target.subVectors(this.player.position, r.mesh.position).normalize();
            }
        }
        
        // 2. Fleeing Phase
        if(distToPlayer < this.fleeDist) {
            if(r.state !== this.STATES.FLEEING_TO_HOLE && r.state !== this.STATES.FLEEING) {
                // Find nearest burrow
                let nearestHole = null;
                let minDist = Infinity;
                for(const b of this.burrows) {
                    const d = r.mesh.position.distanceTo(b);
                    if(d < minDist) { minDist = d; nearestHole = b; }
                }
                
                if(nearestHole && minDist < 30.0) {
                    r.state = this.STATES.FLEEING_TO_HOLE;
                    r.holeTarget = nearestHole;
                } else {
                    r.state = this.STATES.FLEEING;
                }
            }
        }

        // Fleeing Logic
        if(r.state === this.STATES.FLEEING_TO_HOLE) {
            r.target.subVectors(r.holeTarget, r.mesh.position);
            r.target.y = 0;
            r.target.normalize();
        } else if (r.state === this.STATES.FLEEING) {
            // Flee away from player
            r.target.subVectors(r.mesh.position, this.player.position);
            r.target.y = 0;
            // Add slight zig-zag
            r.target.x += (Math.random() - 0.5) * 0.5;
            r.target.z += (Math.random() - 0.5) * 0.5;
            r.target.normalize();
            
            if(distToPlayer > this.alertDist + 5.0) {
                r.state = this.STATES.IDLE;
                r.timer = 1.0;
            }
        }
        
        // 3. Mother Following
        if(r.role === 'BUNNY' && r.mother && r.state < this.STATES.FREEZING) {
            const distToMom = r.mesh.position.distanceTo(r.mother.mesh.position);
            if(distToMom > 5.0) {
                r.state = this.STATES.FOLLOWING_MOM;
            }
        }
        if(r.state === this.STATES.FOLLOWING_MOM) {
            if(!r.mother || r.mesh.position.distanceTo(r.mother.mesh.position) < 2.0) {
                r.state = this.STATES.IDLE;
                r.timer = 1.0;
            } else {
                r.target.subVectors(r.mother.mesh.position, r.mesh.position);
                r.target.y = 0;
                r.target.normalize();
            }
        }

        // 4. Kid-Friendly High-Frequency State Timer
        if(r.state < this.STATES.FREEZING) {
            r.timer -= delta;
            if(r.timer <= 0) {
                // Max 1 second idle actions
                r.timer = 0.2 + Math.random() * 0.8;
                const roll = Math.random();
                if(roll < 0.3) r.state = this.STATES.IDLE;
                else if(roll < 0.6) r.state = this.STATES.EATING; // Nibbling
                else if(roll < 0.8) r.state = this.STATES.GROOMING;
                else {
                    r.state = this.STATES.WALKING;
                    const angle = Math.random() * Math.PI * 2;
                    r.target.set(Math.sin(angle), 0, Math.cos(angle));
                }
            }
        }
    }
    
    updatePhysics(r, delta) {
        if(r.state === this.STATES.HIDDEN) return;
        
        const pos = r.mesh.position;
        let speed = 0;
        let jumpHeight = 0;
        
        if(r.state === this.STATES.WALKING) { speed = this.walkSpeed; jumpHeight = 0.3 * r.baseScale; }
        if(r.state === this.STATES.RUNNING || r.state === this.STATES.FLEEING || r.state === this.STATES.FLEEING_TO_HOLE) { speed = this.runSpeed; jumpHeight = 0.8 * r.baseScale; }
        if(r.state === this.STATES.FOLLOWING_MOM) { speed = this.babySpeed; jumpHeight = 0.5 * r.baseScale; }
        
        // Reset scale/rotation base
        r.internalMesh.rotation.set(0, Math.PI, 0);
        r.mesh.scale.set(r.baseScale, r.baseScale, r.baseScale);

        // Safe Ground Pattern
        const localGroundY = this.getHeight(pos.x, pos.z);
        let hopYOffset = 0;
        
        // Gather and Jump Locomotion
        if (speed > 0) {
            r.hopCycle += speed * 0.8 * delta; // Increased frequency for shorter, quicker hops
            if (r.hopCycle > 1.0) r.hopCycle = 0;
            
            // Phase Isolation: Air phase is 0.3 to 0.7
            if (r.hopCycle > 0.3 && r.hopCycle < 0.7) {
                // Translation only happens in the air
                const airSpeed = speed * 1.2; // Reduced dramatically from 2.0 to shorten jump distance
                pos.addScaledVector(r.target, airSpeed * delta);
                
                // Parabolic Y offset
                const airProgress = (r.hopCycle - 0.3) / 0.4; // 0.0 to 1.0
                hopYOffset = Math.sin(airProgress * Math.PI) * jumpHeight;
            } else {
                // Grounded "Gather" Phase - no translation
                hopYOffset = 0;
            }
            
            // Orient smoothly
            const targetAngle = Math.atan2(r.target.x, r.target.z);
            let diff = targetAngle - r.mesh.rotation.y;
            while(diff < -Math.PI) diff += Math.PI * 2;
            while(diff > Math.PI) diff -= Math.PI * 2;
            r.mesh.rotation.y += diff * 15 * delta;
        } else {
            r.hopCycle = 0; // Reset
        }
        
        // Hole Dive Physics Override
        if (r.state === this.STATES.FLEEING_TO_HOLE && r.holeTarget) {
            const distToHole = Math.sqrt((pos.x - r.holeTarget.x)**2 + (pos.z - r.holeTarget.z)**2);
            if (distToHole < 0.5) {
                // Successfully entered hole
                r.state = this.STATES.HIDDEN;
                r.timer = 5.0 + Math.random() * 5.0;
                r.mesh.visible = false;
            } else if (distToHole < 2.0) {
                // Sinking into terrain
                const diveDepth = (2.0 - distToHole) * 1.5; 
                hopYOffset -= diveDepth;
            }
        }
        
        // Head Bobbing for Eating/Grooming
        if (r.state === this.STATES.EATING) {
            r.internalMesh.rotation.x = Math.sin(Date.now() * 0.01) * 0.2 + 0.2; // Head down nibbling
        } else if (r.state === this.STATES.GROOMING) {
            r.internalMesh.rotation.z = Math.sin(Date.now() * 0.015) * 0.15; // Scratching shake
        } else if (r.state === this.STATES.PEEK_OUT) {
            r.internalMesh.rotation.x = -0.2; // Head up, alert
        }
        
        // Final Ground Application
        pos.y = localGroundY + hopYOffset;
    }
}
