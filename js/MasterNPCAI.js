/**
 * MasterNPCAI.js
 * Centralized NPC Intelligence & Behavioral Controller
 * 
 * Implements a formal Finite State Machine (FSM) architecture.
 * Eliminates brittle "if/else" timer chains in favor of explicit 
 * state transitions with guaranteed onEnter/onExit animation crossfading.
 */

class FSMState {
    constructor(name, ai) {
        this.name = name;
        this.ai = ai; // The NPC context
    }
    onEnter() {}
    onUpdate(delta, flags) {}
    onExit() {}
}

// === Core FSM States ===
class StateSitting extends FSMState {
    onEnter() {
        if (this.ai.actions.sit) {
            this.ai.actions.sit.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
            // Force frame 0 to avoid T-pose
            if (this.ai.mixer) this.ai.mixer.update(0); 
        }
    }
    onUpdate(delta, flags) {
        if (flags.isEngaged && this.ai.id !== 'NPC_BHG') { 
            // BHG might stay sitting longer, but others stand up
            this.ai.fsm.transition('STANDING_UP');
        }
    }
}

class StateStandingUp extends FSMState {
    onEnter() {
        this.timer = 1.0; // 1 second to stand up
        if (this.ai.actions.sit && this.ai.actions.idle) {
            this.ai.actions.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
            this.ai.actions.sit.crossFadeTo(this.ai.actions.idle, 0.5, false);
        }
    }
    onUpdate(delta, flags) {
        this.timer -= delta;
        if (this.timer <= 0) {
            this.ai.fsm.transition('WALKING_OUT');
        }
    }
}

class StateWalkingOut extends FSMState {
    onEnter() {
        // Find destination just outside the tipi. The Tipi faces -Z locally (or +Z depending on rotation).
        // For YB, tipi is at 0,0 and faces +Z natively, but wait, she is rotated.
        // We will just move them relative to their current orientation, forward by ~2 units.
        this.targetDist = 2.0;
        this.startPos = this.ai.mesh.position.clone();
        
        // Use a generic walk animation if available, otherwise just slide (using idle)
        if (this.ai.actions.walk) {
            this.ai.actions.walk.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
            if (this.ai.actions.idle) this.ai.actions.idle.crossFadeTo(this.ai.actions.walk, 0.5, false);
        }
    }
    
    onUpdate(delta, flags) {
        if (!this.ai.mesh) return;
        
        // Move forward locally
        const walkSpeed = 1.0;
        this.ai.mesh.translateZ(walkSpeed * delta);
        
        const distMoved = this.ai.mesh.position.distanceTo(this.startPos);
        if (distMoved >= this.targetDist) {
            this.ai.fsm.transition('GREETING');
        }
    }
    
    onExit() {
        if (this.ai.actions.walk && this.ai.actions.idle) {
            this.ai.actions.walk.crossFadeTo(this.ai.actions.idle, 0.5, false);
        }
    }
}

class StateGreeting extends FSMState {
    onEnter() {
        this.timer = 2.0; // wave for 2 seconds
        if (this.ai.actions.wave) {
            this.ai.actions.wave.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
            if (this.ai.actions.idle) this.ai.actions.idle.crossFadeTo(this.ai.actions.wave, 0.2, false);
        }
    }
    onUpdate(delta, flags) {
        // Head tracking logic is handled globally in MasterNPCAI update
        this.timer -= delta;
        if (this.timer <= 0) {
            this.ai.fsm.transition('IDLE');
        }
    }
    onExit() {
        if (this.ai.actions.wave && this.ai.actions.idle) {
            this.ai.actions.wave.crossFadeTo(this.ai.actions.idle, 0.4, false);
        }
    }
}

class StateIdle extends FSMState {
    onEnter() {
        if (this.ai.actions.idle) {
            this.ai.actions.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        }
    }
    onUpdate(delta, flags) {
        if (!flags.isEngaged && flags.dist2D > 10.0) {
            // Player left, go back to sitting
            // Teleport back to start pos for now (or walk back)
            if (this.ai.originalPos) {
                this.ai.mesh.position.copy(this.ai.originalPos);
            }
            this.ai.fsm.transition('SITTING');
        }
    }
}

class StateMachine {
    constructor(ai) {
        this.ai = ai;
        this.states = new Map();
        this.currentState = null;
    }
    addState(name, stateClass) {
        this.states.set(name, new stateClass(name, this.ai));
    }
    transition(name) {
        if (!this.states.has(name)) return;
        if (this.currentState) {
            this.currentState.onExit();
        }
        this.currentState = this.states.get(name);
        this.ai.state = name; // For debugging and Journal
        this.currentState.onEnter();
    }
    update(delta, flags) {
        if (this.currentState) {
            this.currentState.onUpdate(delta, flags);
        }
    }
}
// === Nature Spirit FSM States ===
class StateStagWalkIn extends FSMState {
    onEnter() {
        this.ai.opacityTarget = 0.7; // Fade in completely
        if (this.ai.actions && this.ai.actions.walk) {
            this.ai.actions.walk.reset().play();
        }
    }
    onUpdate(delta, flags) {
        if (!this.ai.mesh) return;
        
        // Player Interruption: Spooked if camera gets within 4.5 units
        if (flags.dist2D < 4.5) {
            this.ai.fsm.transition('STAG_TURN');
            return;
        }
        
        // Target: Near Yellow Butterfly (-3.0, 1.0)
        const dxIn = -3.0 - this.ai.mesh.position.x;
        const dzIn = 1.0 - this.ai.mesh.position.z;
        const distIn = Math.sqrt(dxIn * dxIn + dzIn * dzIn);
        
        if (distIn > 1.0) {
            const targetRotIn = Math.atan2(dxIn, dzIn);
            let diffIn = targetRotIn - this.ai.mesh.rotation.y;
            while(diffIn < -Math.PI) diffIn += Math.PI * 2;
            while(diffIn > Math.PI) diffIn -= Math.PI * 2;
            this.ai.mesh.rotation.y += diffIn * 3 * delta;
            
            this.ai.mesh.translateZ(1.5 * delta); // speed = 1.5
        } else {
            this.ai.fsm.transition('STAG_NOD');
        }
    }
}

class StateStagNod extends FSMState {
    onEnter() {
        this.timer = 4.0; // Nod/Bow for 4 seconds
        if (this.ai.actions && this.ai.actions.wave && this.ai.actions.walk) {
            this.ai.actions.walk.crossFadeTo(this.ai.actions.wave, 1.0, false);
            this.ai.actions.wave.reset().play();
        }
    }
    onUpdate(delta, flags) {
        if (flags.dist2D < 4.5) {
            if (this.ai.actions && this.ai.actions.wave && this.ai.actions.walk) {
                this.ai.actions.wave.crossFadeTo(this.ai.actions.walk, 0.5, false);
                this.ai.actions.walk.reset().play();
            }
            this.ai.fsm.transition('STAG_TURN');
            return;
        }
        
        this.timer -= delta;
        if (this.timer <= 0) {
            if (this.ai.actions && this.ai.actions.wave && this.ai.actions.walk) {
                this.ai.actions.wave.crossFadeTo(this.ai.actions.walk, 1.0, false);
                this.ai.actions.walk.reset().play();
            }
            this.ai.fsm.transition('STAG_TURN');
        }
    }
}

class StateStagTurn extends FSMState {
    onEnter() {}
    onUpdate(delta, flags) {
        if (!this.ai.mesh) return;
        // Target: North-East forest (15.0, -25.0)
        const dxTurn = 15.0 - this.ai.mesh.position.x;
        const dzTurn = -25.0 - this.ai.mesh.position.z;
        const targetRotTurn = Math.atan2(dxTurn, dzTurn);
        
        let diffTurn = targetRotTurn - this.ai.mesh.rotation.y;
        while(diffTurn < -Math.PI) diffTurn += Math.PI * 2;
        while(diffTurn > Math.PI) diffTurn -= Math.PI * 2;
        
        this.ai.mesh.rotation.y += diffTurn * 1.5 * delta;
        
        if (Math.abs(diffTurn) < 0.2) {
            this.ai.fsm.transition('STAG_WALKOUT');
        }
    }
}

class StateStagWalkOut extends FSMState {
    onEnter() {}
    onUpdate(delta, flags) {
        if (!this.ai.mesh) return;
        const dxOut = 15.0 - this.ai.mesh.position.x;
        const dzOut = -25.0 - this.ai.mesh.position.z;
        const distOut = Math.sqrt(dxOut * dxOut + dzOut * dzOut);
        
        this.ai.opacityTarget = Math.max(0.0, Math.min(0.7, (distOut - 2.0) * 0.05));
        
        if (distOut > 2.0) {
            const targetRotOut = Math.atan2(dxOut, dzOut);
            let diffOut = targetRotOut - this.ai.mesh.rotation.y;
            while(diffOut < -Math.PI) diffOut += Math.PI * 2;
            while(diffOut > Math.PI) diffOut -= Math.PI * 2;
            this.ai.mesh.rotation.y += diffOut * 3 * delta;
            
            this.ai.mesh.translateZ(1.5 * delta);
        } else {
            this.ai.fsm.transition('STAG_COOLDOWN');
        }
    }
}

class StateStagCooldown extends FSMState {
    onEnter() {
        this.timer = 300.0; // 5 minutes cooldown
        this.ai.opacityTarget = 0.0;
        if (this.ai.actions && this.ai.actions.walk) {
            this.ai.actions.walk.stop();
        }
    }
    onUpdate(delta, flags) {
        this.timer -= delta;
        if (this.timer <= 0) {
            if (this.ai.mesh) {
                this.ai.mesh.position.set(25.0, 0, 0.0);
            }
            this.ai.fsm.transition('STAG_WALKIN');
        }
    }
}

class MasterNPCAI {
    constructor() {
        this.npcs = new Map();
        
        // --- AWARENESS THRESHOLDS ---
        this.ranges = {
            WATCHING: 15.0,  // NPC tracks player with head
            ENGAGED: 5.0,    // NPC triggers state transition (e.g. stand up)
            INACTIVE: 30.0   // NPC stops logic updates completely
        };
        
        this.personalityMatrix = {
            'NPC_YB': { name: 'Yellow Butterfly', archetype: 'Guardian Guide' },
            'NPC_BHG': { name: 'Brings Happiness Girl', archetype: 'Village Elder' },
            'NPC_Reg': { name: 'Reg', archetype: 'Spiritual Guide' }
        };
    }

    register(id, npcInstance) {
        console.log(`[MasterNPCAI] Registering NPC FSM: ${id}`);
        npcInstance.id = id;
        npcInstance.metadata = this.personalityMatrix[id] || { name: id, archetype: 'Villager' };
        
        // --- BONE DISCOVERY (For sentient 'Watching' behavior) ---
        npcInstance.bones = { head: null };
        if (npcInstance.mesh) {
            npcInstance.mesh.traverse(child => {
                if (child.isBone) {
                    const name = child.name.toLowerCase();
                    if (name.includes('head') || name.includes('neck')) {
                        npcInstance.bones.head = child;
                    }
                }
            });
        }
        
        // Initialize FSM
        npcInstance.fsm = new StateMachine(npcInstance);
        
        if (id === 'NatureSpirit') {
            npcInstance.fsm.addState('STAG_WALKIN', StateStagWalkIn);
            npcInstance.fsm.addState('STAG_NOD', StateStagNod);
            npcInstance.fsm.addState('STAG_TURN', StateStagTurn);
            npcInstance.fsm.addState('STAG_WALKOUT', StateStagWalkOut);
            npcInstance.fsm.addState('STAG_COOLDOWN', StateStagCooldown);
            npcInstance.fsm.transition('STAG_WALKIN');
        } else {
            // Default human FSM
            npcInstance.originalPos = npcInstance.mesh ? npcInstance.mesh.position.clone() : null;
            npcInstance.fsm.addState('SITTING', StateSitting);
            npcInstance.fsm.addState('STANDING_UP', StateStandingUp);
            npcInstance.fsm.addState('WALKING_OUT', StateWalkingOut);
            npcInstance.fsm.addState('GREETING', StateGreeting);
            npcInstance.fsm.addState('IDLE', StateIdle);
            npcInstance.fsm.transition('SITTING');
        }
        
        this.npcs.set(id, npcInstance);
    }

    update(delta, params = {}) {
        const playerPos = (params && params.playerPos) || (window.camera ? window.camera.position : null);
        const gameStarted = !!window._gameStartedCTA;

        for (const [id, npc] of this.npcs) {
            // 0. Animation Heartbeat (Force Update Always)
            if (npc.mixer) {
                npc.mixer.update(delta);
            }

            let distToPlayer = 999;
            if (playerPos && npc.mesh) {
                // User Request: "make sure you properly calculate that in the world so there is none of the model detection, use 3d not 2d detection."
                const dx = playerPos.x - npc.mesh.position.x;
                const dy = playerPos.y - npc.mesh.position.y;
                const dz = playerPos.z - npc.mesh.position.z;
                distToPlayer = Math.sqrt(dx*dx + dy*dy + dz*dz);
            }

            if (distToPlayer > this.ranges.INACTIVE && id !== 'NatureSpirit') continue;

            // 0.5 Ambient Environmental Updates (For NatureSpirit)
            if (id === 'NatureSpirit' && npc.mesh) {
                const now = performance.now() * 0.001;
                const pulse = 0.3 + (Math.sin(now * 2) * 0.5 + 0.5) * 0.5;
                
                npc.currentOpacity = npc.currentOpacity || 0;
                npc.opacityTarget = (npc.opacityTarget !== undefined) ? npc.opacityTarget : 0;
                npc.currentOpacity += (npc.opacityTarget - npc.currentOpacity) * 2.0 * delta;
                
                if (npc.materials) {
                    npc.materials.forEach(mat => {
                        if (mat) {
                            mat.opacity = npc.currentOpacity;
                            mat.emissiveIntensity = pulse * npc.currentOpacity;
                            mat.visible = npc.currentOpacity > 0.01;
                        }
                    });
                }

                if (typeof window._getGroundY === 'function') {
                    const groundY = window._getGroundY(npc.mesh.position.x, npc.mesh.position.z);
                    const targetY = groundY + 3.2; 
                    npc.mesh.position.y += (targetY - npc.mesh.position.y) * 5.0 * delta;
                }
            }

            // 1. Head Tracking (Watching) - Independent of FSM State
            if (npc.bones.head && playerPos && distToPlayer < this.ranges.WATCHING) {
                // Determine target look direction in local space
                let localPlayer;
                if (npc.mesh.worldToLocal) {
                    localPlayer = npc.mesh.worldToLocal(playerPos.clone());
                } else {
                    localPlayer = {x: 0, z: 1};
                }
                const targetRot = Math.atan2(localPlayer.x, localPlayer.z);
                
                // Limit head rotation to 60 degrees
                const limit = Math.PI / 3;
                const cappedRot = Math.max(-limit, Math.min(limit, targetRot));
                
                // Smooth lerp
                npc.bones.head.rotation.y += (cappedRot - npc.bones.head.rotation.y) * 4 * delta;
            } else if (npc.bones.head) {
                npc.bones.head.rotation.y += (0 - npc.bones.head.rotation.y) * 2 * delta;
            }

            // 2. Body Orientation (Look at Player if Engaged and Standing)
            if (distToPlayer < this.ranges.ENGAGED && (npc.state === 'IDLE' || npc.state === 'GREETING')) {
                if (playerPos && npc.mesh) {
                    const dx = playerPos.x - npc.mesh.position.x;
                    const dz = playerPos.z - npc.mesh.position.z;
                    const targetAngle = Math.atan2(dx, dz);
                    // Smooth slerp/lerp using MathUtils
                    npc.mesh.rotation.y += (targetAngle - npc.mesh.rotation.y) * 2 * delta;
                }
            }

            // 3. FSM Update
            const flags = {
                dist2D: distToPlayer || 999,
                isWatching: (distToPlayer < this.ranges.WATCHING),
                isEngaged: (distToPlayer < this.ranges.ENGAGED),
                playerPos,
                gameStarted
            };
            
            if (npc.fsm) {
                npc.fsm.update(delta, flags);
            }

            // 4. Export State for Journal LLM
            if (!window._npcStates) window._npcStates = {};
            window._npcStates[id] = {
                name: npc.metadata.name,
                action: npc.state,
                isAware: flags.isEngaged,
                location: npc.mesh ? { x: npc.mesh.position.x, z: npc.mesh.position.z } : null
            };
        }
    }
}

window.MasterNPCAI = MasterNPCAI;



