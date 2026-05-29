// js/Component.PostProcessing.js

// Expose functions globally to maintain legacy compatibility while extracting from monolith
window.setupLensflare = function(sunLight) {
  if (typeof THREE === "undefined" || typeof Lensflare === "undefined") return;

  // Procedural Flare Texture (Canvas)
  const getFlareTexture = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255, 255, 255, 1)");
    grd.addColorStop(0.2, "rgba(255, 255, 200, 0.5)");
    grd.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  };

  const flare = new Lensflare();
  flare.addElement(new LensflareElement(getFlareTexture(), 60, 0)); // Sun disc — subtle, not a billboard
  flare.addElement(new LensflareElement(getFlareTexture(), 20, 0.3)); // Small secondary glint
  flare.addElement(new LensflareElement(getFlareTexture(), 10, 0.6)); // Tiny tertiary
  sunLight.add(flare);

  // Expose globally so we can intercept it and physically hide it during Map passes
  window._globalFlare = flare;
};

window.setupOpticalMask = function() {
    // REMOVED: Optical mask disabled to restore bright, happy sanctuary vibe.
};

window.setupPostProcessing = function(scene, camera, renderer) {
    if (!window.SacredState) window.SacredState = {};
    if (typeof EffectComposer === 'undefined' || typeof RenderPass === 'undefined') return;
    
    // Re-instantiate the EffectComposer for the Main Camera but gate it through FuzzyBrain
    const renderScene = new RenderPass(scene, camera);
    
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);

    // 2. High-Fidelity Depth of Field (Shift-Tilt / Macro / Toy miniature look)
    const bokehPass = new BokehPass(scene, camera, {
        focus: 14.0,
        aperture: 0.015,
        maxblur: 0.025,
        width: window.innerWidth,
        height: window.innerHeight
    });
    // Force enabled by default for authentic toy diorama aesthetics
    bokehPass.enabled = true;
    composer.addPass(bokehPass);
    
    // 3. Immersive Vignette & Optical FX Shader
    const vignetteShader = {
        uniforms: {
            "tDiffuse": { value: null },
            "color": { value: new THREE.Color(0x050510) },     // Very faint dark blue
            "tipiScreenPos": { value: new THREE.Vector2(-9, -9) }, // Hide by default
            "tipiScreenRadius": { value: 0.15 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform vec3 color;
            uniform vec2 tipiScreenPos;
            uniform float tipiScreenRadius;
            varying vec2 vUv;
            
            void main() {
                vec4 texel = texture2D(tDiffuse, vUv);
                
                // Distance from exact center screen
                vec2 center = vec2(0.5, 0.5);
                float dist = distance(vUv, center);
                
                // 3-stage radial focus blur:
                // Inner 1/3 (dist < 0.24) is perfect center focus.
                // Middle 1/3 (0.24 <= dist < 0.48) is 30% less focused.
                // Outer 1/3 (dist >= 0.48) is 30% less focused than that.
                float blurAmount = 0.0;
                if (dist > 0.24) {
                    if (dist > 0.48) {
                        blurAmount = 0.008; // heavy outer blur
                    } else {
                        // middle blur with smooth boundary transition from perfect center
                        float transition = smoothstep(0.24, 0.28, dist);
                        blurAmount = mix(0.0, 0.003, transition);
                    }
                }
                
                // Sample texture with beautiful radial blur disc if needed
                if (blurAmount > 0.0) {
                    vec4 sum = vec4(0.0);
                    sum += texture2D(tDiffuse, vUv + vec2(-0.707 * blurAmount, -0.707 * blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(0.707 * blurAmount, -0.707 * blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(-0.707 * blurAmount, 0.707 * blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(0.707 * blurAmount, 0.707 * blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(0.0, -blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(0.0, blurAmount));
                    sum += texture2D(tDiffuse, vUv + vec2(-blurAmount, 0.0));
                    sum += texture2D(tDiffuse, vUv + vec2(blurAmount, 0.0));
                    texel = sum / 8.0;
                }
                
                // Volumetric atmospheric haze overlay (warm/cool misty atmosphere)
                vec3 hazeColor = vec3(0.92, 0.94, 0.96);
                float hazeStrength = clamp(dist * 0.25 + blurAmount * 15.0, 0.0, 0.35);
                texel.rgb = mix(texel.rgb, hazeColor, hazeStrength);

                // Heavy, rich toy-diorama vignette
                float vignette = smoothstep(0.28, 0.72, dist) * 0.75;
                
                // Tipi Mask (pierce the vignette so the bright tipi shines through)
                float tipiDist = distance(vUv, tipiScreenPos);
                float tipiMask = smoothstep(tipiScreenRadius * 0.5, tipiScreenRadius, tipiDist);
                
                // Mix base image with vignette darkness multiplier (not pitch black)
                texel.rgb = mix(texel.rgb, texel.rgb * 0.3 + color * 0.1, vignette * tipiMask);
                
                gl_FragColor = texel;
            }
        `
    };
    
    window.humanEyePass = new ShaderPass(vignetteShader);
    composer.addPass(window.humanEyePass);

    // Assign globally for FuzzyBrain throttling
    window.SacredState.composer = composer;
    window.SacredState.bokehPass = bokehPass;
    
    // Note: FuzzyBrain handles toggling this in its evaluate() phase
    // by setting fuzzyBrain.postProcess = { composer: window.SacredState.composer }
    if (window.fuzzyBrain) {
        window.fuzzyBrain.postProcess = { composer: window.SacredState.composer };
        window.fuzzyBrain.applyPostProcessing(true);
    }
};
