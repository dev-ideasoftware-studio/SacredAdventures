/**
 * Sacred Adventures - Map Scene Generator UI.
 *
 * A right-side panel that only appears in top-down "Village View".
 * Shows only when body has v4-top-down-view class.
 * Placeholder UI for future random scene generation tools.
 */

const STYLE = [
  "#v4-map-generator {",
  "  position: fixed;",
  "  right: 12px;",
  "  top: 12px;",
  "  display: none;",
  "  flex-direction: column;",
  "  gap: 12px;",
  "  z-index: 9100;",
  "  user-select: none;",
  "  pointer-events: none;",
  "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
  "  background: rgba(10, 18, 14, 0.88);",
  "  backdrop-filter: blur(6px);",
  "  border: 1px solid rgba(251,192,45,0.28);",
  "  box-shadow: 0 2px 12px rgba(0,0,0,0.45);",
  "  border-radius: 10px;",
  "  padding: 14px;",
  "  min-width: 200px;",
  "  color: #e6f0d8;",
  "}",
  "body.v4-top-down-view #v4-map-generator { display: flex; }",
  "#v4-map-generator .mgn-header {",
  "  font-size: 9px;",
  "  letter-spacing: 3px;",
  "  color: rgba(251,192,45,0.65);",
  "  font-weight: 800;",
  "  padding-bottom: 8px;",
  "  border-bottom: 1px solid rgba(251,192,45,0.12);",
  "  text-transform: uppercase;",
  "}",
  "#v4-map-generator .mgn-hint {",
  "  font-size: 10px;",
  "  line-height: 1.5;",
  "  color: rgba(200,210,190,0.7);",
  "}",
  "#v4-map-generator button {",
  "  pointer-events: auto;",
  "  background: linear-gradient(180deg, rgba(40,26,20,0.94), rgba(15,10,8,0.97));",
  "  border: 1px solid rgba(255,217,122,0.30);",
  "  border-bottom: 3px solid rgba(251,192,45,0.65);",
  "  border-radius: 4px;",
  "  color: #ffe9a8;",
  "  padding: 8px 12px;",
  "  font-size: 10px;",
  "  font-weight: 800;",
  "  letter-spacing: 1.5px;",
  "  cursor: pointer;",
  "  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
  "  transition: transform 120ms ease, background 120ms ease;",
  "}",
  "#v4-map-generator button:hover {",
  "  transform: translateY(-1px);",
  "  background: linear-gradient(180deg, rgba(60,38,24,0.95), rgba(28,18,12,0.99));",
  "}",
  "#v4-map-generator button:active { transform: translateY(0); }",
].join("\n");

function ensureStyle() {
  if (document.getElementById("v4-map-generator-style")) return;
  const s = document.createElement("style");
  s.id = "v4-map-generator-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function buildDom() {
  const wrap = document.createElement("div");
  wrap.id = "v4-map-generator";

  const header = document.createElement("div");
  header.className = "mgn-header";
  header.textContent = "MAP SCENE GENERATOR";

  const hint = document.createElement("div");
  hint.className = "mgn-hint";
  hint.textContent = "Build random scenes for your world - coming soon!";

  const btnGenerate = document.createElement("button");
  btnGenerate.id = "v4-btn-gen-scene";
  btnGenerate.textContent = "\u2728 GENERATE SCENE";

  const btnClear = document.createElement("button");
  btnClear.id = "v4-btn-clear-scene";
  btnClear.textContent = "\uD83D\uDDD1 CLEAR SCENE";

  wrap.appendChild(header);
  wrap.appendChild(hint);
  wrap.appendChild(btnGenerate);
  wrap.appendChild(btnClear);

  document.body.appendChild(wrap);
  return wrap;
}

export const SanctuaryMapGeneratorUiModule = {
  name: "SanctuaryMapGeneratorUi",
  _el: null,

  async load() {
    ensureStyle();
    this._el = buildDom();
    console.log(
      "%c[Sanctuary] Map Generator UI ready.",
      "color:#ffd97a;font-weight:bold;"
    );
  },

  update() {},

  unload() {
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    const s = document.getElementById("v4-map-generator-style");
    if (s && s.parentNode) s.parentNode.removeChild(s);
    this._el = null;
  },
};
