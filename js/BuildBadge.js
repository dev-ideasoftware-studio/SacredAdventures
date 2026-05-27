/**
 * BuildBadge — fixed bottom-left commit/sync indicator.
 *
 * Reads build-info.json (written by scripts/build-info.mjs via the
 * post-commit hook) and renders a high-contrast pill showing the last
 * commit subject, timestamp (relative + absolute), branch, SW cache
 * version, and a DIRTY flag if the working tree has uncommitted changes.
 *
 * Purpose: every AI agent + the user can see at a glance which commit
 * the current page actually reflects, so "I committed X" claims can be
 * verified against on-screen truth. Placed bottom-left, high z-index,
 * always on top of the main canvas.
 */

function relTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const dSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (dSec < 60) return `${dSec}s ago`;
  if (dSec < 3600) return `${Math.round(dSec / 60)}m ago`;
  if (dSec < 86400) return `${Math.round(dSec / 3600)}h ago`;
  return `${Math.round(dSec / 86400)}d ago`;
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function fetchBuildInfo() {
  try {
    const res = await fetch(`./build-info.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function render(info) {
  let el = document.getElementById("build-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "build-badge";
    Object.assign(el.style, {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      zIndex: "999999",
      padding: "8px 12px",
      borderRadius: "8px",
      background: "rgba(14, 12, 10, 0.88)",
      color: "#f5ecdc",
      font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
      letterSpacing: "0.02em",
      maxWidth: "min(58vw, 540px)",
      pointerEvents: "auto",
      border: "1px solid rgba(198, 160, 53, 0.35)",
      boxShadow: "0 6px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,140,0.10)",
      userSelect: "text",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    document.body.appendChild(el);
  }

  if (!info) {
    el.innerHTML = `<span style="color:#ff8a6e">⚠ build-info.json missing — run <code>npm run build-info</code></span>`;
    return;
  }

  const dirtyTag = info.dirty
    ? `<span style="color:#ff5a3c;font-weight:700"> · ✱ UNCOMMITTED</span>`
    : "";
  const swTag = info.swVersion
    ? ` · <span style="color:#c8a546">sw ${info.swVersion}</span>`
    : "";
  const isoShort = (info.isoDate || "").replace("T", " ").slice(0, 16);
  const rel = relTime(info.isoDate);
  const subject = truncate(info.subject || "(no subject)", 64);
  const branch = info.branch || "?";

  el.title = `branch: ${branch}\nsubject: ${info.subject}\ncommit time: ${info.isoDate}\nbuild info generated: ${info.generatedAt}\nSW cache: ${info.swVersion}\ndirty: ${info.dirty}`;
  el.innerHTML = `<span style="color:#c8a546;font-weight:700">${branch}</span>${swTag} · <span>${subject}</span> · <span style="color:#a39577">${rel} (${isoShort})</span>${dirtyTag}`;
}

export async function mountBuildBadge() {
  const info = await fetchBuildInfo();
  render(info);
  setInterval(() => render(info), 30_000);
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountBuildBadge());
  } else {
    mountBuildBadge();
  }
}
