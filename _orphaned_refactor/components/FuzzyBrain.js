export class FuzzyBrain {
    constructor(renderer, scene, renderPipeline, config = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.renderPipeline = renderPipeline;
        
        // Target configs (Optimized for 120Hz displays)
        this.targetFPS = config.targetFPS || 120;
        this.criticalFPS = config.criticalFPS || 60;
        this.recoveryFPS = config.recoveryFPS || 100;

        // Metrics
        this.frameTimes = [];
        this.windowSize = 30;
        this.currentFPS = 120;
        this.smoothFPS = 120;
        this.frameCount = 0;

        // State Profile: 0=ULTRA, 1=HIGH, 2=MEDIUM, 3=LOW, 4=SURVIVAL
        this.qualityLevel = 0;
        this.cooldownFrames = 0;
        this.cooldownDuration = 60;
        
        this.shadowLights = [];
    }

    registerShadowLight(light) {
        this.shadowLights.push(light);
    }

    update(delta) {
        this.frameCount++;
        
        const clampedDelta = Math.min(delta, 0.1);
        this.frameTimes.push(clampedDelta);
        if (this.frameTimes.length > this.windowSize) this.frameTimes.shift();

        if (this.frameTimes.length >= 5) {
            const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
            this.currentFPS = 1.0 / Math.max(avgDelta, 0.001);
            this.smoothFPS = this.smoothFPS * 0.9 + this.currentFPS * 0.1;
        }

        if (this.cooldownFrames > 0) {
            this.cooldownFrames--;
        } else {
            this.evaluate();
        }
    }

    evaluate() {
        if (this.smoothFPS < this.criticalFPS && this.qualityLevel < 4) {
            this.setQuality(Math.min(this.qualityLevel + 2, 4));
        } else if (this.smoothFPS < this.targetFPS && this.qualityLevel < 4) {
            this.setQuality(this.qualityLevel + 1);
        } else if (this.smoothFPS > this.recoveryFPS && this.qualityLevel > 0) {
            this.setQuality(this.qualityLevel - 1);
        }
    }

    setQuality(level) {
        if (level === this.qualityLevel) return;
        this.qualityLevel = Math.max(0, Math.min(4, level));
        this.cooldownFrames = this.cooldownDuration;
        
        // Enforce max scale of 1.0 logic to not burn retinas
        const devicePR = Math.min(window.devicePixelRatio || 1, 1.0);
        let scalingFactor = 1.0;

        if (this.qualityLevel >= 2) scalingFactor = 0.75;
        if (this.qualityLevel >= 4) scalingFactor = 0.5;

        this.renderer.setPixelRatio(devicePR * scalingFactor);

        // Shadows
        const enableShadows = this.qualityLevel < 3;
        this.renderer.shadowMap.enabled = enableShadows;
        this.shadowLights.forEach(light => {
            light.castShadow = enableShadows;
        });

        console.log(`[FuzzyBrain] Quality adjusted to tier ${this.qualityLevel}. Scaling at ${scalingFactor}x, Shadows: ${enableShadows}`);
    }
}
