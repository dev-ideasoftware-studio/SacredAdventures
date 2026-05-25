/**
 * Sacred Adventures — sanctuary: Journal ↔ Anu bridge.
 *
 * The SacredGame.Journal.html iframe communicates exclusively via
 * postMessage (self-contained, no Panel dependencies). This module
 * sits in the parent window, translates those messages into Anu's
 * InteractionBus events, AND replies to journal-side queries with
 * fresh sensorium / governance snapshots.
 *
 * Why a dedicated bridge module:
 *   • Anu wants to KNOW about UI state changes — journal open/close is
 *     a player-mode signal Anu reads in its sensorium roll-up.
 *   • The journal wants to DISPLAY live world state — entity counts,
 *     governance check pass-rate, active modules, audit findings.
 *   • Keeping the bridge as an orchestrator-registered module means it
 *     shows up in `AnuUniverse.audit()`, `getGovernanceSnapshot()`, and
 *     the active-modules list. Anu treats it like any other simulation
 *     participant — no special-case wiring.
 *
 * Inbound (journal → parent):
 *   LOGBOOK_VISIBILITY  { isVisible: boolean }
 *   JOURNAL_OPENED / JOURNAL_CLOSED
 *   REQ_ANU_SENSORIUM   (request snapshot — we reply with ANU_SENSORIUM_REPLY)
 *   REQ_ANU_AUDIT       (request audit — we reply with ANU_AUDIT_REPLY)
 *
 * Outbound (parent → journal):
 *   ANU_SENSORIUM_REPLY { schemaVersion, activeModules, entityCounts, ... }
 *   ANU_AUDIT_REPLY     { findings: [], healthyChecks, totalChecks, pct }
 *   ANU_GREETING        sent on first journal-load so the journal knows
 *                       the bridge is alive.
 *
 * Dispatched on InteractionBus (parent → Anu sensorium):
 *   "sanctuary-journal-visibility"  { isVisible, source }
 *   "sanctuary-journal-request"     { kind: 'sensorium'|'audit', tFired }
 */

import { dispatchInteraction } from "../v2/anu/InteractionBus.js";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

const JOURNAL_FRAME_ID = "v4-journal-frame";

const EV_JOURNAL_VIS = "sanctuary-journal-visibility";
const EV_JOURNAL_REQ = "sanctuary-journal-request";

function _journalFrameWin() {
  const f = document.getElementById(JOURNAL_FRAME_ID);
  return f?.contentWindow ?? null;
}

function _postToJournal(payload) {
  try { _journalFrameWin()?.postMessage(payload, "*"); } catch (_e) { /* iframe may be torn down */ }
}

/** Snapshot the live Anu sensorium for the journal to render. */
function _readAnuSensorium() {
  const A = (typeof window !== "undefined") ? window.AnuUniverse : null;
  if (!A) return { ok: false, reason: "AnuUniverse not yet on window" };
  const out = {
    ok: true,
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    activeModules: null,
    audit: null,
    governance: null,
    sensorium: null,
  };
  try { out.activeModules = (window.anuOrchestrator?._activeModules || []).slice(); } catch (_e) {}
  try { out.audit = A.audit?.() ?? null; } catch (_e) {}
  try {
    const gov = A.getGovernanceSnapshot?.();
    if (gov?.checks) {
      const total = gov.checks.length;
      const ok = gov.checks.filter(c => c?.ok === true).length;
      out.governance = { totalChecks: total, healthyChecks: ok, pct: total > 0 ? Math.round((ok / total) * 100) : 100, state: gov.state ?? null };
    }
  } catch (_e) {}
  try {
    const s = A.getWorldSensoriumSnapshot?.();
    out.sensorium = s ? {
      identity: s.identity ?? null,
      // Trim heavy nested objects — only the headline counts ride to the journal.
      domains: s.domains ? Object.fromEntries(Object.entries(s.domains).map(([k, v]) => [k, typeof v === "object" && v ? (v.count ?? v.entities?.length ?? null) : v])) : null,
    } : null;
  } catch (_e) {}
  return out;
}

export const SanctuaryJournalBridgeModule = {
  name: "SanctuaryJournalBridge",

  _onMessage: null,
  _greetTimer: 0,

  async load() {
    if (typeof window === "undefined") return;

    // Outbound bridge: when ANY of the journal's postMessages land on
    // window, translate the player-mode signals into InteractionBus
    // dispatches Anu sees. Replies to data requests with fresh snapshots.
    this._onMessage = (event) => {
      const d = event?.data;
      if (!d || typeof d.type !== "string") return;
      const t = d.type;

      // ── Visibility signals (3 names — all flow to one Anu event) ───
      if (t === "LOGBOOK_VISIBILITY" || t === "JOURNAL_OPENED" || t === "JOURNAL_CLOSED") {
        const isVisible = t === "JOURNAL_OPENED"
          ? true
          : t === "JOURNAL_CLOSED"
            ? false
            : !!d.isVisible;
        try {
          dispatchInteraction(EV_JOURNAL_VIS, {
            isVisible,
            source: "SacredGame.Journal.html",
            domain: ANU_SIMULATION_DOMAIN.PLAYER,
            t: performance.now(),
          });
        } catch (_e) { /* never throw from bridge */ }
        return;
      }

      // ── Data requests (journal asks parent for live Anu state) ────
      if (t === "REQ_ANU_SENSORIUM") {
        try { dispatchInteraction(EV_JOURNAL_REQ, { kind: "sensorium", tFired: performance.now() }); } catch (_e) {}
        _postToJournal({ type: "ANU_SENSORIUM_REPLY", payload: _readAnuSensorium() });
        return;
      }
      if (t === "REQ_ANU_AUDIT") {
        try { dispatchInteraction(EV_JOURNAL_REQ, { kind: "audit", tFired: performance.now() }); } catch (_e) {}
        const a = window.AnuUniverse?.audit?.() ?? [];
        _postToJournal({ type: "ANU_AUDIT_REPLY", payload: { findings: a, count: Array.isArray(a) ? a.length : 0 } });
        return;
      }
    };
    window.addEventListener("message", this._onMessage);

    // Greet the journal once it's loaded — gives it a chance to render
    // the "Anu connected" indicator without polling. We try a few times
    // because the iframe may load lazily on first J-press.
    this._greetTimer = window.setInterval(() => {
      if (_journalFrameWin()) {
        _postToJournal({ type: "ANU_GREETING", from: "SanctuaryJournalBridge", t: Date.now() });
      }
    }, 1500);

    // DevTools API — quick poke for debugging.
    window.sanctuaryJournalBridge = {
      readAnu: () => _readAnuSensorium(),
      poke:    () => _postToJournal({ type: "ANU_GREETING", from: "manual", t: Date.now() }),
      visible: (b) => dispatchInteraction(EV_JOURNAL_VIS, { isVisible: !!b, source: "devtools" }),
    };

    console.log(
      "%c[Sanctuary] 📓 Journal ↔ Anu bridge online — listens for LOGBOOK_VISIBILITY / JOURNAL_OPENED / CLOSED, replies to REQ_ANU_SENSORIUM / REQ_ANU_AUDIT.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  unload() {
    if (this._onMessage) {
      window.removeEventListener("message", this._onMessage);
      this._onMessage = null;
    }
    if (this._greetTimer) {
      window.clearInterval(this._greetTimer);
      this._greetTimer = 0;
    }
    delete window.sanctuaryJournalBridge;
  },
};
