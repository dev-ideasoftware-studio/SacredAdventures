/**
 * SanctuarySceneConstructor.js
 *
 * A lightweight asset loading and compiling performance wrapper.
 * Ensures that all texture loads and shader compilations are telemetry-asserted 
 * to monitor their impact on the game's 60 FPS frame budget (16.67ms).
 */

import * as THREE from "three";

/** The game targets 60 FPS (Mark, 2026-10-22): one frame = 16.67 ms. */
const FRAME_BUDGET_MS = 1000 / 60;

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
      duration <= FRAME_BUDGET_MS
        ? "color:#a5d6a7; font-weight:bold;" 
        : "color:#ffb74d; font-weight:bold;"
    );

    return texture;
  }

  /**
   * Helper to assert that a synchronous block of initialization logic
   * stays under the 60 FPS frame budget (16.67ms).
   */
  static assertPerformance(label, fn) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    if (duration > FRAME_BUDGET_MS) {
      console.warn(
        `%c[Telemetry] ⚠️ PERFORMANCE SPIKE: "${label}" took ${duration.toFixed(2)}ms (exceeded the 16.67ms frame budget for 60 FPS)`,
        "color:#ff8c8c; font-weight:bold;"
      );
    } else {
      console.log(
        `%c[Telemetry] ✅ "${label}" completed in ${duration.toFixed(2)}ms (under the 16.67ms frame budget)`,
        "color:#81c784;"
      );
    }
    return result;
  }
}
