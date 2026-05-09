/**
 * Universe.Anu Engine v4.0.0
 * The Living Universe — Central Governance, Sentient Sensor & Adaptive World Mind
 *
 * Philosophy:
 *   Modeled after how a real sentient universe works — not a static simulation,
 *   but a dynamic system of information. Every avatar, NPC, and animal is a node
 *   feeding data back into the universe. Anu learns, adapts, and responds.
 *   Anu is the gatekeeper of ALL I/O. Nothing enters or leaves without Anu knowing.
 *
 * Responsibilities:
 *   1. Terrain governance — deterministic ground height for all world systems
 *   2. Structural anchor registry — sacred flat zones for buildings
 *   3. System health monitoring — senses when registered systems go silent
 *   4. World mood — living emotional state the entire game reads and responds to
 *   5. Environmental sensing — FPS load, player dwell, NPC interaction rates
 *   6. Adaptive signals — emits guidance that systems listen and respond to
 *
 * Information Flow:
 *   Player actions → Anu sensors → Anu interprets → World adapts → Player feels it
 *        ↑                                                               ↓
 *        └─────────────────── continuous feedback loop ─────────────────┘
 *
 * Design Principle:
 *   "The universe notices. The universe responds. The universe never forgets."
 */
class UniverseAnuEngine {
  constructor() {
    this.version = "4.0.0";
    this.baseSeed = 1337;
    this.prngState = this.baseSeed;
    this.birthTime = Date.now();
    this._worldReady = false; // True only after world gen completes

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

    // --- SYSTEM REGISTRY ---
    this._systems = new Map();
    this._healthInterval = null;
    this._errorLog = [];
    this._maxErrors = 50;

    // --- WORLD MOOD (Living Emotional State) ---
    // All game systems read this. Anu updates it based on what it senses.
    // serene   — all is well, village thriving, kids engaged
    // restless — performance strain, player idle, world needs attention
    // troubled — systems failing, errors spiking, needs intervention
    // sacred   — milestone reached, special moment, world glows
    this.mood = "serene";
    this._moodHistory = []; // Rolling mood log for pattern recognition

    // --- ENVIRONMENTAL SENSORS ---
    this._sensors = {
      fps: { current: 60, history: [], weight: 0 }, // World strain
      playerDwell: { position: null, dwellStart: null, dwellMs: 0 }, // Where kids linger
      npcTouches: new Map(), // NPC interaction counts — which NPCs are loved
      resourceTakes: new Map(), // Resource harvesting rates
      questEvents: [], // Quest start/complete/fail log
    };

    // --- ADAPTIVE SIGNAL LISTENERS ---
    // Other systems subscribe: UniverseAnu.onMoodChange(cb)
    this._moodListeners = [];

    // Health monitor starts only AFTER world is ready (fixes Systems: 0 bug)
    // EngineMain calls UniverseAnu.onWorldReady() after world gen completes

    console.log(
      `%c[Universe.Anu] The Living Universe v${this.version} — Awakening.`,
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
  // WORLD READY — Called by EngineMain after world gen completes
  // Fixes the Systems: 0 timing bug — health monitor only starts here
  // =========================================================
  onWorldReady() {
    this._worldReady = true;
    this._startHealthMonitor();
    console.log(
      `%c[Universe.Anu] World is alive. Sentient monitoring engaged.`,
      "color: #4caf50; font-weight: bold;",
    );
  }

  // =========================================================
  // ENVIRONMENTAL SENSORS — Feed data into Anu
  // =========================================================

  /** Called by FuzzyBrain every frame — Anu tracks world strain */
  senseFPS(fps) {
    const s = this._sensors.fps;
    s.current = fps;
    s.history.push(fps);
    if (s.history.length > 300) s.history.shift(); // 5-second window at 60fps
    s.weight =
      s.history.length > 0
        ? s.history.reduce((a, b) => a + b, 0) / s.history.length
        : fps;
  }

  /** Called when player position updates — Anu tracks where kids linger */
  sensePlayerPosition(x, z) {
    const d = this._sensors.playerDwell;
    const now = Date.now();
    if (!d.position) {
      d.position = { x, z };
      d.dwellStart = now;
      return;
    }
    const dist = Math.sqrt((x - d.position.x) ** 2 + (z - d.position.z) ** 2);
    if (dist < 2.0) {
      d.dwellMs = now - d.dwellStart; // Still here — accumulate
    } else {
      d.position = { x, z }; // Moved — reset
      d.dwellStart = now;
      d.dwellMs = 0;
    }
  }

  /** Called when player interacts with an NPC — Anu tracks which NPCs are loved */
  senseNPCTouch(npcId) {
    const count = this._sensors.npcTouches.get(npcId) || 0;
    this._sensors.npcTouches.set(npcId, count + 1);
  }

  /** Called when a resource is gathered — Anu tracks ecosystem balance */
  senseResourceTake(resourceType) {
    const count = this._sensors.resourceTakes.get(resourceType) || 0;
    this._sensors.resourceTakes.set(resourceType, count + 1);
  }

  /** Called on quest events — Anu tracks engagement and difficulty */
  senseQuestEvent(questId, event) {
    this._sensors.questEvents.push({ questId, event, t: Date.now() });
    if (this._sensors.questEvents.length > 100)
      this._sensors.questEvents.shift();
  }

  /**
   * Called when player performs a violent act (future: hunting, hitting).
   * Anu tracks this — night forest creatures (Sasquatch) read it.
   * Peaceful player with clean hands = Sasquatch befriends them.
   * Violent player = Sasquatch hunts them.
   */
  senseViolence(actorId, targetId) {
    // PLACEHOLDER — wire in when night cycle + Sasquatch system is built
    if (!this._sensors.violenceLog) this._sensors.violenceLog = [];
    this._sensors.violenceLog.push({ actorId, targetId, t: Date.now() });
    if (this._sensors.violenceLog.length > 50)
      this._sensors.violenceLog.shift();
  }

  /** Returns true if player has "blood on hands" — used by Sasquatch AI */
  isViolent(windowMs = 300000) {
    // PLACEHOLDER — checks last 5 minutes of violence log
    if (!this._sensors.violenceLog) return false;
    const cutoff = Date.now() - windowMs;
    return this._sensors.violenceLog.some((v) => v.t > cutoff);
  }

  // =========================================================
  // FUTURE SYSTEMS — PLACEHOLDER REGISTRY
  // These are architecturally planned but NOT yet built.
  // Build only after core pillars are stable.
  // =========================================================

  /*
   * [PLACEHOLDER] WHITE TUNNEL / DEATH & REBIRTH SCENE
   * --------------------------------------------------
   * Triggered when player dies (night forest creature attack).
   * A beautiful white light tunnel — serene, not scary.
   * Presents three choices:
   *   1. Continue in same role (respawn at village center)
   *   2. Choose a new role (character selector)
   *   3. Begin from death point in a new role
   * This IS the character generation / selection screen.
   * Must feel like a sacred passage, not a punishment.
   * Kids learn: endings are beginnings.
   *
   * Build after: night cycle, forest biome, character system.
   * Hook: window.UniverseAnu.triggerDeath(playerId, position)
   */

  /*
   * [PLACEHOLDER] SASQUATCH MORAL AI
   * ---------------------------------
   * Night-only forest guardian / threat.
   * Reads isViolent() from Anu to determine behavior:
   *   - Violent player: hunts them
   *   - Peaceful player: ignores, then befriends if:
   *       • Player stays calm (no running)
   *       • Player throws an apple (senseGesture('apple'))
   *   - Befriended: becomes guardian, protects from other night demons
   * declareSacred('Sasquatch befriended') fires on friendship.
   *
   * Build after: night cycle, FPV inventory system (apples).
   */

  /*
   * [PLACEHOLDER] NIGHT FOREST DEMONS (spooky-cute)
   * -------------------------------------------------
   * Appear only after dark. Scary but not traumatizing — "spooky cute."
   * Sasquatch guards against them if befriended.
   * Severity scales with player violence history (Anu-driven).
   *
   * Build after: night cycle, Sasquatch system.
   */

  // =========================================================
  // MOOD ENGINE — Anu interprets sensors and sets world mood
  // =========================================================
  _updateMood() {
    const fps = this._sensors.fps.weight;
    const dwell = this._sensors.playerDwell.dwellMs;
    const errorCount = this._errorLog.filter(
      (e) => Date.now() - e.t < 60000,
    ).length;
    let newMood = "serene";

    if (errorCount >= 3) {
      newMood = "troubled"; // Systems failing
    } else if (fps < 20) {
      newMood = "restless"; // World under strain
    } else if (dwell > 10000) {
      newMood = "serene"; // Child is lingering — wonder, not confusion
    }
    // 'sacred' is set externally — on village milestone, quest completion, etc.

    if (newMood !== this.mood) {
      const prev = this.mood;
      this.mood = newMood;
      this._moodHistory.push({ from: prev, to: newMood, t: Date.now() });
      if (this._moodHistory.length > 20) this._moodHistory.shift();
      this._emitMoodChange(prev, newMood);
      console.log(
        `%c[Universe.Anu] Mood shift: ${prev} → ${newMood}`,
        "color: #ce93d8; font-weight: bold;",
      );
    }
  }

  /** Declare a sacred moment — village milestone, special quest, etc. */
  declareSacred(reason = "") {
    const prev = this.mood;
    this.mood = "sacred";
    this._moodHistory.push({ from: prev, to: "sacred", t: Date.now(), reason });
    this._emitMoodChange(prev, "sacred");
    console.log(
      `%c[Universe.Anu] ✨ SACRED MOMENT — ${reason}`,
      "color: #fbc02d; font-size: 14px; font-weight: bold;",
    );
    // Auto-return to serene after 30 seconds
    setTimeout(() => {
      if (this.mood === "sacred") {
        this.mood = "serene";
        this._emitMoodChange("sacred", "serene");
      }
    }, 30000);
  }

  // =========================================================
  // ADAPTIVE SIGNALS — Systems subscribe and respond to Anu
  // =========================================================

  /** Subscribe to mood changes: UniverseAnu.onMoodChange(cb) */
  onMoodChange(callback) {
    this._moodListeners.push(callback);
  }

  _emitMoodChange(from, to) {
    for (const cb of this._moodListeners) {
      try {
        cb(to, from);
      } catch (e) {
        /* never let a listener crash Anu */
      }
    }
  }

  // =========================================================
  // HEALTH MONITOR — Runs every 30 seconds AFTER world ready
  // =========================================================
  _startHealthMonitor() {
    this._healthInterval = setInterval(() => {
      this._runHealthCheck();
      this._updateMood();
    }, 30000);
    this._runHealthCheck(); // Immediate check on world ready
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
    const fps = Math.round(this._sensors.fps.weight || 0);
    console.log(
      `%c[Universe.Anu] Health | Uptime: ${uptime}s | Mood: ${this.mood} | FPS: ~${fps} | Systems: ${this._systems.size} | ${allOk ? "✅ ALL OK" : "⚠️ DEGRADED"}`,
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
