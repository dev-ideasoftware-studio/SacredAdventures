#!/usr/bin/env node
/**
 * stamp-build.mjs — SACRED-AI-PIPELINE build signature stamp.
 *
 * Each AI agent runs this after making a build so the on-canvas build
 * badge shows WHO last touched the running build:
 *
 *   node scripts/stamp-build.mjs "Gemini"
 *   node scripts/stamp-build.mjs "Claude v4.6"
 *   node scripts/stamp-build.mjs "Claude-Orchestrator"
 *
 * Writes build-signature.json at repo root (gitignored, shared across
 * all agents on this filesystem). js/BuildBadge.js renders it to the
 * left of the build version line.
 */
import { writeFileSync } from "node:fs";

const agent = (process.argv[2] || "").trim();
if (!agent) {
  console.error('Usage: node scripts/stamp-build.mjs "<AgentName>"');
  process.exit(1);
}

const sig = {
  agent,
  updatedAt: new Date().toISOString(),
};
writeFileSync("build-signature.json", JSON.stringify(sig, null, 2) + "\n");
console.log(`[stamp-build] ${agent} signed the build at ${sig.updatedAt}`);
