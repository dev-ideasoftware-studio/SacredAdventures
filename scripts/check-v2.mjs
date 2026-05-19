#!/usr/bin/env node
/**
 * v2 syntax gate — Phase 9+ hardening.
 *
 * Walks `js/v2/` (and `js/v2/anu/`) and runs `node --input-type=module --check`
 * on every `.js` file. Self-healing: new v2 modules are picked up the moment
 * they land, so the gate can't silently drift (which it did between baseline
 * 2026-05-10 and the May-12 feature drop — see ANU score audit).
 *
 * Exits non-zero on the first syntax failure and prints the offending file +
 * stderr from `node --check`.
 */

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const V2_ROOT = path.join(ROOT, "js", "v2");

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs);
    else if (ent.isFile() && abs.endsWith(".js")) yield abs;
  }
}

const files = [];
for await (const f of walk(V2_ROOT)) files.push(f);
files.sort();

let failures = 0;
for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  const src = await fs.readFile(abs, "utf8");
  const res = spawnSync(
    process.execPath,
    ["--input-type=module", "--check"],
    { input: src, encoding: "utf8" },
  );
  if (res.status !== 0) {
    failures++;
    console.error(`✗ ${rel}`);
    if (res.stderr) console.error(res.stderr.trim());
  }
}

if (failures > 0) {
  console.error(`\n✗ check:v2 FAIL — ${failures} file${failures === 1 ? "" : "s"} with syntax errors (of ${files.length} scanned)`);
  process.exit(1);
} else {
  console.log(`✓ check:v2 PASS — ${files.length} v2 modules syntax-checked`);
}
