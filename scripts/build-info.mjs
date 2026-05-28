#!/usr/bin/env node
/**
 * Writes build-info.json at repo root with the latest commit's metadata.
 * Consumed by js/BuildBadge.js to render the bottom-left build banner.
 *
 * SHA is intentionally omitted — when run inside a post-commit hook that
 * amends the file back into HEAD, the SHA changes after amend so any value
 * we wrote would be stale. Subject + timestamp + branch are stable across
 * --amend --no-edit, so those are what we publish.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

const subject = git("git log -1 --pretty=%s");
const isoDate = git("git log -1 --pretty=%cI");
const branch  = git("git rev-parse --abbrev-ref HEAD");

const porcelain = git("git status --porcelain");
const dirty = porcelain.length > 0;

let commit = "?";
try {
  commit = git("git rev-parse --short HEAD");
} catch {}

let swVersion = "?";
try {
  const sw = readFileSync("sw.js", "utf8");
  const m = sw.match(/CACHE_VERSION\s*=\s*"([^"]+)"/);
  if (m) swVersion = m[1];
} catch { /* sw.js may not exist in some checkouts */ }

const info = { subject, isoDate, branch, swVersion, commit, dirty, generatedAt: new Date().toISOString() };
writeFileSync("build-info.json", JSON.stringify(info, null, 2) + "\n");
console.log(`[build-info] ${branch} · sw ${swVersion} (${commit}) · ${isoDate} · ${subject}${dirty ? " (DIRTY)" : ""}`);
