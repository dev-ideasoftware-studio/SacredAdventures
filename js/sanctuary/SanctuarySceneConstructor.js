/**
 * SanctuarySceneConstructor.js
 *
 * A lightweight asset loading and compiling performance wrapper.
 * Ensures that all texture loads and shader compilations are telemetry-asserted 
 * to monitor their impact on our strict 120 FPS budget (8.33ms).
 */

import * as THREE from "three";

export class SanctuarySceneConstructor {
  /**
   * Loads a texture asynchronously with high-precision performance monitoring.
   */
  static async loadTexture(loader, url, name) {
    const start = performance.now();
    const texture = await loader.loadAsync(url);
    const duration = performance.now() - start;

    console.log(
      `%c[Telemetry] 📂 Texture "${name}" loaded in ${duration.toFixed(2)}ms.`,
      duration <= 8.33 
        ? "color:#a5d6a7; font-weight:bold;" 
        : "color:#ffb74d; font-weight:bold;"
    );

    return texture;
  }

  /**
   * Helper to assert that a synchronous block of initialization logic
   * stays strictly under the 8.33ms frame budget limit.
   */
  static assertPerformance(label, fn) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    if (duration > 8.33) {
      console.warn(
        `%c[Telemetry] ⚠️ PERFORMANCE SPIKE: "${label}" took ${duration.toFixed(2)}ms (exceeded 8.33ms target for 120 FPS!)`,
        "color:#ff8c8c; font-weight:bold;"
      );
    } else {
      console.log(
        `%c[Telemetry] ✅ "${label}" completed in ${duration.toFixed(2)}ms (under 8.33ms target)`,
        "color:#81c784;"
      );
    }
    return result;
  }
}
