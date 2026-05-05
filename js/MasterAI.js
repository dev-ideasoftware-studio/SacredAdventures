/**
 * MasterAI.js
 * The Wildlife Director & Ecological Orchestrator
 * 
 * Manages all non-sentient life (Rabbits, Birds, Herds).
 * Uses a Fixed-Time-Step (30Hz) to ensure AI simulation remains 
 * fully deterministic and perfectly decoupled from rendering framerates.
 */

window.MasterAI = class MasterAI {
    constructor() {
        this.state = 'ACTIVE';
        this.creatureSystems = new Map();
        
        // Fixed Time Step (30 FPS Simulation)
        this.timeAccumulator = 0;
        this.fixedDelta = 1.0 / 30.0;
        
        console.log(`%c[MasterAI] Wildlife Director Initialized.`, "color: #ff9800; font-weight: bold;");
    }

    /**
     * Registers a creature system for fixed-time updates.
     */
    registerSystem(name, system) {
        if (!system) return;
        this.creatureSystems.set(name, system);
        console.log(`[MasterAI] Registered Ecosystem: ${name}`);
    }

    /**
     * Called by EngineMain.js every frame.
     * Accumulates real delta time and ticks the AI in fixed steps.
     */
    update(realDelta) {
        // Prevent huge lag spikes from causing the "Spiral of Death"
        const clampedDelta = Math.min(realDelta, 0.1);
        
        this.timeAccumulator += clampedDelta;

        while (this.timeAccumulator >= this.fixedDelta) {
            this.tick(this.fixedDelta);
            this.timeAccumulator -= this.fixedDelta;
        }
    }

    /**
     * Internal Fixed-Time Tick
     */
    tick(delta) {
        for (const [name, sys] of this.creatureSystems) {
            if (typeof sys.update === 'function') {
                try {
                    sys.update(delta);
                } catch (e) {
                    console.error(`[MasterAI] Error in system ${name}:`, e);
                }
            }
        }
    }

    /**
     * Legacy bootstrap fallback
     */
    bootstrap(onReadyCallback) {
        if (document.readyState === 'complete') {
            this._start(onReadyCallback);
        } else {
            window.addEventListener('load', () => this._start(onReadyCallback));
        }
    }

    _start(onReadyCallback) {
        window.documentReady = true;
        if (onReadyCallback) onReadyCallback();
    }
}

