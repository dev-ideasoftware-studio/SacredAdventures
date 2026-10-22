// Shader-patch checker: finds onBeforeCompile `.replace(target, …)` calls whose target string
// never appears in the RAW three r160 shader text, i.e. patches that silently do nothing.
//
// Usage (from repo root):  node tools/decision-engine/patchcheck.mjs [files...]
//   default files: every js/sanctuary/*.js
// Exit code 1 if any dead target is found.
//
// Why "raw": onBeforeCompile receives ShaderLib text BEFORE `#include <chunk>` lines are expanded,
// so a target copied from a chunk's body (e.g. "texture2D( normalMap, vNormalMapUv ).xyz") is dead
// unless an earlier patch in the same callback pasted that chunk in. Both cases are accepted here:
// a target is live if it is in any ShaderLib program, or in a string the same file inserts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const THREE = await import(pathToFileURL(path.join(REPO, "vendor/three/three.module.js")).href);
const raw = [];
for (const lib of Object.values(THREE.ShaderLib)) raw.push(lib.vertexShader || "", lib.fragmentShader || "");
const RAW = raw.join("\n");

let files = process.argv.slice(2);
if (!files.length) files = fs.readdirSync("js/sanctuary").filter((f) => f.endsWith(".js")).map((f) => "js/sanctuary/" + f);

// literal first argument of .replace( — "…", '…' or `…` without ${}
const RX = /\.replace\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)\s*,/g;
const unescape = (s) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(["'`\\])/g, "$1");
const results = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (!/onBeforeCompile/.test(src)) continue;
  const lines = src.split("\n");
  let m;
  while ((m = RX.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    // only lines that patch shader text
    const ctx = lines.slice(Math.max(0, line - 4), line).join("\n");
    if (!/(vertexShader|fragmentShader)/.test(ctx)) continue;
    const target = unescape(m[1] ?? m[2] ?? m[3]);
    const inRaw = RAW.includes(target);
    // inserted by this file (template literal bodies of earlier replaces) — counts as live
    const inFile = !inRaw && src.split(target).length > 2;
    results.push({ file: f, line, target: target.slice(0, 70), live: inRaw || inFile, via: inRaw ? "ShaderLib" : inFile ? "inserted-by-file" : "NONE" });
  }
}
const dead = results.filter((r) => !r.live);
console.log(JSON.stringify({ checked: results.length, dead }, null, 1));
process.exit(dead.length ? 1 : 0);
