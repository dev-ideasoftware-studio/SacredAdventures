#!/usr/bin/env node
/**
 * Sacred Assets Gate — Phase 1 of the 78→100 program.
 *
 * Scans source trees for `Assets/...` (and `WORDPRESS/Assets/...`) references and
 * validates each unique path against the filesystem:
 *   • file exists
 *   • for `.glb`, the first 4 bytes are the `glTF` magic
 *
 * Two tiers:
 *   • STRICT  — references found in the canonical v2 runtime fail the gate
 *               (exit 1) when missing/corrupt. This is what `npm test` enforces.
 *   • WARN    — references found only in legacy / WordPress / SacredOnes.1 / scratch
 *               trees emit a warning but do **not** fail the gate. Phase 7
 *               (legacy reconciliation) will decide their fate.
 *
 * Also reports a taxonomy summary: how many referenced assets currently live
 * under the five canonical buckets (`Assets/{flora,fauna,npc,buildings,landscape-scenes}/`)
 * vs. unclassified at the root of `Assets/`. This is informational only.
 *
 * Flags:
 *   --strict       Promote WARN findings to failures.
 *   --json         Emit a machine-readable summary on stdout (no pretty output).
 *   --quiet        Suppress per-file logging; only the summary + failures.
 *   --list         Print every unique asset reference (no checks).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const STRICT_FLAG = args.has("--strict");
const JSON_FLAG = args.has("--json");
const QUIET = args.has("--quiet") || JSON_FLAG;
const LIST_ONLY = args.has("--list");

/** Strict tier: any ref found here makes that asset's failure a gate failure. */
const STRICT_TREES = ["js/v2", "index.v2.html"];

/** Warn tier: scanned for completeness but failures here are informational. */
const WARN_TREES = [
  "js",
  "dist",
  "WORDPRESS",
  "SacredOnes.1",
  "_legacy_archive",
  "scratch",
  // top-level files that load assets
  "Component.ThreeIcons.js",
  "Component.LoadingModal.html",
  "Component.NewJournal.html",
  "SacredGame.Journal.html",
  "SacredGame.Panel.html",
  "SacredOnes.html",
  "index.html",
  "launch.html",
  "manifest.json",
  "sw.js",
];

const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".html", ".json", ".md", ".txt"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".cursor", "test-results", "playwright-report",
  "vendor", // third-party three.js etc.
]);

const ASSET_RE =
  /(?:\.{1,2}\/)*((?:WORDPRESS\/)?Assets\/[A-Za-z0-9_\-./]+?\.(?:glb|png|jpg|jpeg|webp|mp3|mp4|obj|gltf|wasm))/g;

const TAXONOMY_DIRS = new Set([
  "flora", "fauna", "npc", "buildings", "landscape-scenes",
]);

const GLB_MAGIC = Buffer.from([0x67, 0x6c, 0x54, 0x46]); // "glTF"

const results = {
  refs: new Map(), // normalizedAssetPath -> { tier, sources: [{file,line,raw}] }
  files: { scanned: 0, withRefs: 0 },
  failures: [], // [{path, reason, sources}]
  warnings: [], // [{path, reason, sources}]
  taxonomy: { classified: 0, unclassified: 0, breakdown: {} },
};

function log(...a) { if (!QUIET) console.log(...a); }
function err(...a) { console.error(...a); }

async function* walk(dirAbs, topRel) {
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dirAbs, ent.name);
    const rel = path.relative(ROOT, abs);
    if (ent.isDirectory()) {
      yield* walk(abs, topRel);
    } else if (ent.isFile()) {
      if (SCAN_EXTS.has(path.extname(ent.name))) {
        yield { abs, rel, top: topRel };
      }
    }
  }
}

function normalizeAssetPath(raw) {
  let p = raw.replace(/^(?:\.{1,2}\/)+/, "");
  // collapse duplicate slashes
  p = p.replace(/\/{2,}/g, "/");
  return p;
}

function classifyTaxonomy(assetPath) {
  // assetPath is "Assets/..." or "WORDPRESS/Assets/..."
  const inner = assetPath.replace(/^(?:WORDPRESS\/)?Assets\//, "");
  const first = inner.split("/")[0];
  if (TAXONOMY_DIRS.has(first)) return first;
  return null; // unclassified (still at the root of Assets/ today)
}

async function scanFile(entry) {
  let text;
  try { text = await fs.readFile(entry.abs, "utf8"); }
  catch { return; }
  results.files.scanned++;
  let found = false;
  ASSET_RE.lastIndex = 0;
  let m;
  while ((m = ASSET_RE.exec(text)) !== null) {
    found = true;
    const raw = m[1];
    const norm = normalizeAssetPath(raw);
    let entryRec = results.refs.get(norm);
    if (!entryRec) {
      entryRec = { tier: "warn", sources: [] };
      results.refs.set(norm, entryRec);
    }
    // promote tier if strict tree saw it
    const tier = isStrictSource(entry.rel) ? "strict" : "warn";
    if (tier === "strict") entryRec.tier = "strict";
    // capture line number (cheap: count newlines up to match start)
    const upTo = text.slice(0, m.index);
    const line = upTo.split("\n").length;
    entryRec.sources.push({ file: entry.rel, line, raw });
  }
  if (found) results.files.withRefs++;
}

function isStrictSource(relPath) {
  return STRICT_TREES.some((t) => relPath === t || relPath.startsWith(t + path.sep) || relPath.startsWith(t + "/"));
}

async function checkAsset(assetPath, rec) {
  const abs = path.join(ROOT, assetPath);
  let stat;
  try { stat = await fs.stat(abs); }
  catch {
    pushFailure(rec.tier, { path: assetPath, reason: "missing", sources: rec.sources });
    return;
  }
  if (!stat.isFile()) {
    pushFailure(rec.tier, { path: assetPath, reason: "not-a-file", sources: rec.sources });
    return;
  }
  if (assetPath.toLowerCase().endsWith(".glb")) {
    let head;
    try {
      const fd = await fs.open(abs, "r");
      try {
        head = Buffer.alloc(4);
        await fd.read(head, 0, 4, 0);
      } finally { await fd.close(); }
    } catch {
      pushFailure(rec.tier, { path: assetPath, reason: "unreadable", sources: rec.sources });
      return;
    }
    if (!head.equals(GLB_MAGIC)) {
      pushFailure(rec.tier, {
        path: assetPath,
        reason: `bad-glb-magic (got 0x${head.toString("hex")} expected 0x${GLB_MAGIC.toString("hex")})`,
        sources: rec.sources,
      });
      return;
    }
  }
  // taxonomy classification (only for files under Assets/ root, not WORDPRESS/Assets/)
  if (assetPath.startsWith("Assets/")) {
    const bucket = classifyTaxonomy(assetPath);
    if (bucket) {
      results.taxonomy.classified++;
      results.taxonomy.breakdown[bucket] = (results.taxonomy.breakdown[bucket] || 0) + 1;
    } else {
      results.taxonomy.unclassified++;
    }
  }
}

function pushFailure(tier, item) {
  if (tier === "strict" || STRICT_FLAG) results.failures.push(item);
  else results.warnings.push(item);
}

async function main() {
  // Scan strict trees first so tier promotion is deterministic regardless of order.
  for (const tree of STRICT_TREES) {
    const abs = path.join(ROOT, tree);
    let stat;
    try { stat = await fs.stat(abs); } catch { continue; }
    if (stat.isDirectory()) {
      for await (const entry of walk(abs, tree)) await scanFile(entry);
    } else if (stat.isFile() && SCAN_EXTS.has(path.extname(abs))) {
      await scanFile({ abs, rel: tree, top: tree });
    }
  }
  for (const tree of WARN_TREES) {
    const abs = path.join(ROOT, tree);
    let stat;
    try { stat = await fs.stat(abs); } catch { continue; }
    if (stat.isDirectory()) {
      for await (const entry of walk(abs, tree)) await scanFile(entry);
    } else if (stat.isFile() && SCAN_EXTS.has(path.extname(abs))) {
      await scanFile({ abs, rel: tree, top: tree });
    }
  }

  if (LIST_ONLY) {
    for (const [p, rec] of [...results.refs.entries()].sort()) {
      console.log(`${rec.tier === "strict" ? "S" : "W"}  ${p}  (${rec.sources.length} ref${rec.sources.length === 1 ? "" : "s"})`);
    }
    process.exit(0);
  }

  for (const [p, rec] of results.refs) {
    await checkAsset(p, rec);
  }

  if (JSON_FLAG) {
    const summary = {
      filesScanned: results.files.scanned,
      filesWithRefs: results.files.withRefs,
      uniqueAssets: results.refs.size,
      strictRefs: [...results.refs.values()].filter((r) => r.tier === "strict").length,
      failures: results.failures,
      warnings: results.warnings,
      taxonomy: results.taxonomy,
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    process.exit(results.failures.length > 0 ? 1 : 0);
  }

  // Pretty output
  log(`[assets] scanned ${results.files.scanned} files (${results.files.withRefs} contain Assets/ refs)`);
  log(`[assets] unique referenced assets: ${results.refs.size}  (strict: ${[...results.refs.values()].filter((r) => r.tier === "strict").length})`);

  if (results.failures.length > 0) {
    err("");
    err(`✗ ${results.failures.length} STRICT failure${results.failures.length === 1 ? "" : "s"} (gate FAIL):`);
    for (const f of results.failures) {
      err(`  - ${f.path}  [${f.reason}]`);
      for (const s of f.sources.slice(0, 3)) {
        err(`      ↳ ${s.file}:${s.line}  (${s.raw})`);
      }
      if (f.sources.length > 3) err(`      ↳ …and ${f.sources.length - 3} more`);
    }
  }
  if (results.warnings.length > 0) {
    log("");
    log(`! ${results.warnings.length} WARN-tier issue${results.warnings.length === 1 ? "" : "s"} (Phase 7 reconciliation):`);
    for (const w of results.warnings.slice(0, 25)) {
      log(`  - ${w.path}  [${w.reason}]`);
    }
    if (results.warnings.length > 25) {
      log(`  …and ${results.warnings.length - 25} more`);
    }
  }
  // Taxonomy summary
  log("");
  log(`[taxonomy] classified: ${results.taxonomy.classified}, unclassified: ${results.taxonomy.unclassified}`);
  if (Object.keys(results.taxonomy.breakdown).length > 0) {
    for (const [k, v] of Object.entries(results.taxonomy.breakdown).sort()) {
      log(`           ${k}: ${v}`);
    }
  }

  if (results.failures.length === 0) {
    log("");
    log("✓ assets gate PASS");
    process.exit(0);
  } else {
    err("");
    err("✗ assets gate FAIL");
    process.exit(1);
  }
}

main().catch((e) => {
  err("[assets] uncaught error:", e);
  process.exit(2);
});
