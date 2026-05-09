/**
 * Universe.Anu Engine v3.0.0
 * Central Governance, Metaphysical Firmament & Sentient World Monitor
 *
 * Responsibilities:
 *   1. Terrain governance — deterministic ground height for all world systems
 *   2. Structural anchor registry — flat plateaus for buildings/tipis
 *   3. System health monitoring — senses when registered game systems go silent
 *   4. Atmospheric state tracking — day/night, wind, light cycles
 *   5. Integrity reporting — logs world health every 30 seconds
 */
class UniverseAnuEngine {
  constructor() {
    this.version = "3.0.0";
    this.baseSeed = 1337;
    this.prngState = this.baseSeed;
    this.birthTime = Date.now();

    // --- FIRMAMENT (World Physics) ---
    this.firmament = {
      topography: {
        clearingRadius: 30,
        flatRadius: 12.0,
        noiseScale: 0.08,
        noiseIntensity: 1.5,
        anchors: [],
      },
      atmosphere: {
        currentCycle: "day",
        lightIntensity: 1.0,
        windStrength: 1.2,
      },
    };

    // --- CORE ANCHORS (Sacred — never wiped by reconfigure) ---
    this._coreAnchors = [
      { id: "Center_Tipi1", x: 0, z: 0, r: 8, blend: 4 },
      { id: "BHG_Tipi2", x: 12, z: 12, r: 8, blend: 4 },
      { id: "REG_Tipi3", x: -12, z: 12, r: 8, blend: 4 },
    ];
    this._coreAnchors.forEach((a) =>
      this.registerAnchor(a.id, a.x, a.z, a.r, a.blend),
    );

    // --- SYSTEM REGISTRY (Sentient Sensors) ---
    // Each entry: { name, validator: fn→bool, lastSeen: timestamp, status: 'OK'|'WARN'|'DEAD' }
    this._systems = new Map();
    this._healthInterval = null;
    this._errorLog = []; // Rolling log of integrity warnings
    this._maxErrors = 50; // Cap so memory stays bounded

    // Begin health monitoring after boot settles
    setTimeout(() => this._startHealthMonitor(), 8000);

    console.log(
      `%c[Universe.Anu] Governance Engine v${this.version} Initialized.`,
      "color: #fbc02d; font-weight: bold;",
    );
  }

  // =========================================================
  // PRNG — Mulberry32 deterministic randomness
  // =========================================================
  random() {
    let t = (this.prngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // =========================================================
  // ANCHOR REGISTRY
  // =========================================================
  registerAnchor(id, x, z, radius, blend = 4.0) {
    this.firmament.topography.anchors =
      this.firmament.topography.anchors.filter((a) => a.id !== id);
    this.firmament.topography.anchors.push({ id, x, z, r: radius, blend });
    console.log(`[Universe.Anu] Registered Anchor: ${id} at (${x}, ${z})`);
  }

  // =========================================================
  // RECONFIGURE — volatile only, core anchors are sacred
  // =========================================================
  reconfigure(seed = null) {
    this.baseSeed = seed !== null ? seed : Math.floor(Math.random() * 999999);
    this.prngState = this.baseSeed;

    const t = this.firmament.topography;
    t.noiseScale = 0.04 + this.random() * 0.12;
    t.noiseIntensity = 0.8 + this.random() * 2.2;
    this.firmament.atmosphere.windStrength = 0.8 + this.random() * 1.5;

    // Wipe only volatile (non-core) anchors — core tipi platforms are sacred
    const coreIds = new Set(this._coreAnchors.map((a) => a.id));
    t.anchors = t.anchors.filter((a) => coreIds.has(a.id));

    console.log(
      `%c[Universe.Anu] Reconfiguration complete. Seed: ${this.baseSeed}`,
      "color: #4caf50; font-weight: bold;",
    );
  }

  // =========================================================
  // TERRAIN — Master ground height function
  // =========================================================
  getGroundY(gx, gz) {
    const { noiseScale, noiseIntensity, clearingRadius, flatRadius, anchors } =
      this.firmament.topography;

    let y =
      Math.sin(gx * noiseScale) *
        Math.cos(gz * (noiseScale * 1.15)) *
        noiseIntensity +
      Math.sin(gx * 0.25 + gz * 0.18) * 0.35;

    const dist = Math.sqrt(gx * gx + gz * gz);

    if (dist < clearingRadius) {
      if (dist < flatRadius) {
        y = 0;
      } else {
        const t = (dist - flatRadius) / (clearingRadius - flatRadius);
        const weight = 0.5 + 0.5 * Math.cos(t * Math.PI);
        y = y * (1.0 - weight);
      }
    }

    for (const p of anchors) {
      const dx = gx - p.x,
        dz = gz - p.z;
      const pdist = Math.sqrt(dx * dx + dz * dz);
      if (pdist < p.r + p.blend) {
        const pY =
          Math.sin(p.x * noiseScale) *
            Math.cos(p.z * (noiseScale * 1.15)) *
            noiseIntensity +
          Math.sin(p.x * 0.25 + p.z * 0.18) * 0.35;
        if (pdist < p.r) {
          y = pY;
        } else {
          const t = (pdist - p.r) / p.blend;
          const weight = 0.5 + 0.5 * Math.cos(t * Math.PI);
          y = y * (1.0 - weight) + pY * weight;
        }
      }
    }

    return y;
  }

  // =========================================================
  // SYSTEM REGISTRY — Sentient sensors
  // =========================================================

  /**
   * Register a game system for health monitoring.
   * @param {string} name — human readable system name
   * @param {function} validator — returns true if system is alive
   * @param {boolean} critical — if true, DEAD status fires a loud warning
   */
  registerSystem(name, validator, critical = false) {
    this._systems.set(name, {
      name,
      validator,
      critical,
      lastSeen: Date.now(),
      status: "OK",
      failCount: 0,
    });
    console.log(`[Universe.Anu] Sensor registered: ${name}`);
  }

  /**
   * Report a heartbeat for a system — call this from within a system's update loop.
   */
  heartbeat(name) {
    const sys = this._systems.get(name);
    if (sys) {
      sys.lastSeen = Date.now();
      sys.status = "OK";
      sys.failCount = 0;
    }
  }

  /**
   * Log an integrity event (called by any system detecting anomalies).
   */
  logIntegrityEvent(source, message, severity = "WARN") {
    const entry = { t: Date.now(), source, message, severity };
    this._errorLog.push(entry);
    if (this._errorLog.length > this._maxErrors) this._errorLog.shift();
    const color = severity === "CRITICAL" ? "#ff1744" : "#ff9800";
    console.warn(
      `%c[Universe.Anu:${severity}] ${source}: ${message}`,
      `color: ${color}; font-weight: bold;`,
    );
  }

  // =========================================================
  // HEALTH MONITOR — Runs every 30 seconds
  // =========================================================
  _startHealthMonitor() {
    this._healthInterval = setInterval(() => this._runHealthCheck(), 30000);
    this._runHealthCheck(); // Immediate first check after boot
  }

  _runHealthCheck() {
    const now = Date.now();
    const uptime = Math.floor((now - this.birthTime) / 1000);
    let allOk = true;

    for (const [name, sys] of this._systems) {
      const alive =
        typeof sys.validator === "function" ? sys.validator() : false;
      const silentMs = now - sys.lastSeen;

      if (!alive || silentMs > 60000) {
        sys.failCount++;
        sys.status = sys.failCount >= 3 ? "DEAD" : "WARN";
        allOk = false;
        this.logIntegrityEvent(
          name,
          `System silent for ${Math.floor(silentMs / 1000)}s (fails: ${sys.failCount})`,
          sys.status === "DEAD" ? "CRITICAL" : "WARN",
        );
      } else {
        sys.status = "OK";
        sys.failCount = 0;
      }
    }

    const statusColor = allOk ? "#4caf50" : "#ff9800";
    const anchors = this.firmament.topography.anchors.length;
    const systems = this._systems.size;
    console.log(
      `%c[Universe.Anu] Health | Uptime: ${uptime}s | Anchors: ${anchors} | Systems: ${systems} | ${allOk ? "✅ ALL OK" : "⚠️ DEGRADED"}`,
      `color: ${statusColor}; font-weight: bold;`,
    );
  }

  /**
   * Full integrity snapshot — call from console for diagnostics.
   * Usage: window.UniverseAnu.report()
   */
  report() {
    const now = Date.now();
    console.group(
      "%c[Universe.Anu] Full Integrity Report",
      "color: #fbc02d; font-size: 14px; font-weight: bold;",
    );
    console.log(
      `Version: ${this.version} | Uptime: ${Math.floor((now - this.birthTime) / 1000)}s | Seed: ${this.baseSeed}`,
    );
    console.log(
      `Anchors (${this.firmament.topography.anchors.length}):`,
      this.firmament.topography.anchors.map((a) => a.id),
    );
    console.log(`Atmosphere:`, this.firmament.atmosphere);
    console.group("Systems:");
    for (const [name, sys] of this._systems) {
      const icon =
        sys.status === "OK" ? "✅" : sys.status === "WARN" ? "⚠️" : "🔴";
      console.log(
        `${icon} ${name} — ${sys.status} (last seen: ${Math.floor((now - sys.lastSeen) / 1000)}s ago)`,
      );
    }
    console.groupEnd();
    if (this._errorLog.length > 0) {
      console.group(`Recent Integrity Events (${this._errorLog.length}):`);
      this._errorLog.slice(-10).forEach((e) => {
        console.log(`[${e.severity}] ${e.source}: ${e.message}`);
      });
      console.groupEnd();
    } else {
      console.log("No integrity events recorded. ✅");
    }
    console.groupEnd();
  }
}

// Instantiate Global Governance
window.UniverseAnu = new UniverseAnuEngine();
