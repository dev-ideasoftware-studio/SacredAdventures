/**
 * Universe.Anu Engine
 * Central Governance & Metaphysical Firmament Controller
 * 
 * Manages the procedural rules for topography, atmospheric states, 
 * and entity registries across world reconfiguration cycles.
 */
class UniverseAnuEngine {
    constructor() {
        this.version = "2.0.0";
        this.baseSeed = 1337; // Default seed
        this.prngState = this.baseSeed;
        
        // Governance Configuration (The Firmament)
        this.firmament = {
            topography: {
                clearingRadius: 30,
                flatRadius: 12.0,
                noiseScale: 0.08,
                noiseIntensity: 1.5,
                anchors: [] // Dynamically registered flat zones
            },
            atmosphere: {
                currentCycle: 'day',
                lightIntensity: 1.0,
                windStrength: 1.2
            }
        };

        // Register default anchors for initial load
        this.registerAnchor('Center_Tipi1', 0, 0, 8, 4);
        this.registerAnchor('BHG_Tipi2', 12, 12, 8, 4);
        this.registerAnchor('REG_Tipi3', -12, 12, 8, 4);

        console.log(`%c[Universe.Anu] Governance Engine v${this.version} Initialized.`, "color: #fbc02d; font-weight: bold;");
    }

    /**
     * Mulberry32 PRNG for deterministic randomness
     */
    random() {
        let t = this.prngState += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    /**
     * Registers a permanent structural anchor (flat plateau) in the firmament.
     */
    registerAnchor(id, x, z, radius, blend = 4.0) {
        // Remove existing anchor if it shares an ID
        this.firmament.topography.anchors = this.firmament.topography.anchors.filter(a => a.id !== id);
        this.firmament.topography.anchors.push({ id, x, z, r: radius, blend });
        console.log(`[Universe.Anu] Registered Anchor: ${id} at (${x}, ${z})`);
    }

    /**
     * Executes a full metaphysical reconfiguration of the firmament rules.
     * @param {number} seed - Optional seed for deterministic generation.
     */
    reconfigure(seed = null) {
        this.baseSeed = seed !== null ? seed : Math.floor(Math.random() * 999999);
        this.prngState = this.baseSeed;
        
        const t = this.firmament.topography;

        // Procedural Variation within governed bounds using deterministic PRNG
        t.noiseScale = 0.04 + this.random() * 0.12;
        t.noiseIntensity = 0.8 + this.random() * 2.2;

        // Atmosphere variation
        this.firmament.atmosphere.windStrength = 0.8 + this.random() * 1.5;

        // Clear volatile anchors (preserve core ones if necessary, but for now wipe them)
        t.anchors = [];

        console.log(`%c[Universe.Anu] Reconfiguration complete. Seed: ${this.baseSeed}`, "color: #4caf50; font-weight: bold;");
    }

    /**
     * Master Topography Function
     * Calculates precise Y-coordinates based on Anu Governance.
     */
    getGroundY(gx, gz) {
        const { noiseScale, noiseIntensity, clearingRadius, flatRadius, anchors } = this.firmament.topography;
        
        // 1. BASE NOISE (Primary Firmament)
        // Uses a layered sine-wave approach for organic, professional undulation
        let y = (Math.sin(gx * noiseScale) * Math.cos(gz * (noiseScale * 1.15)) * noiseIntensity)
              + (Math.sin(gx * 0.25 + gz * 0.18) * 0.35);

        const dist = Math.sqrt(gx * gx + gz * gz);

        // 2. SACRED CLEARING (Void of the Center)
        if (dist < clearingRadius) {
            if (dist < flatRadius) {
                y = 0; 
            } else {
                // Smooth Cosine Interpolation for professional blending
                const t = (dist - flatRadius) / (clearingRadius - flatRadius);
                const weight = 0.5 + 0.5 * Math.cos(t * Math.PI);
                y = y * (1.0 - weight);
            }
        }
        
        // 3. STRUCTURAL ANCHORS (Dynamic Plateaus)
        for (const p of anchors) {
            const dx = gx - p.x, dz = gz - p.z;
            const pdist = Math.sqrt(dx * dx + dz * dz);
            
            if (pdist < p.r + p.blend) {
                // Calculate plateau height based on its world-space origin noise
                const pY = (Math.sin(p.x * noiseScale) * Math.cos(p.z * (noiseScale * 1.15)) * noiseIntensity)
                         + (Math.sin(p.x * 0.25 + p.z * 0.18) * 0.35);

                if (pdist < p.r) {
                    y = pY;
                } else {
                    const t = (pdist - p.r) / p.blend;
                    const weight = 0.5 + 0.5 * Math.cos(t * Math.PI);
                    y = (y * (1.0 - weight)) + (pY * weight);
                }
            }
        }

        return y;
    }
}

// Instantiate Global Governance
window.UniverseAnu = new UniverseAnuEngine();
