/**
 * Anu Guardian — mechanical "is this AI trustworthy right now?" gate.
 *
 * Beyond anu-sync-check (which verifies runtime sensors are healthy),
 * the Guardian verifies REPO-STATE INVARIANTS that catch the failure
 * modes documented in feedback_gemini_failure_patterns:
 *
 *   1. No forbidden file patterns tracked
 *      (.bak, .glb.bak, .bak.original, *.glb.bak.original)
 *   2. No tracked files inside gitignored dirs (.archive/, backups/)
 *   3. Sacred.Adventures.BAD/ has zero tracked files (never committed)
 *   4. Every recent commit went through the post-commit hook
 *      (= includes build-info.json in its diff)
 *   5. Reflog amend pattern: each commit subject has ≤ 1 legit amend
 *      (more = suspicious manual rework)
 *   6. check:v2 + check:assets exit 0
 *
 * If this passes, the AI session is in a verifiable trustworthy
 * state. If it fails, something's wrong — STOP and investigate
 * before doing more work.
 *
 * Prints a structured GUARDIAN AUDIT block. AI sessions MUST quote
 * this verbatim (same discipline as ANU SYNC REPORT).
 */
const { test, expect } = require("@playwright/test");
const { execSync } = require("node:child_process");

const FORBIDDEN_PATTERNS = [
  /\.bak$/,
  /\.bak\.original$/,
  /\.glb\.bak$/,
  /\.glb\.bak\.original$/,
  /\.preSimplify\.glb$/,  // backups belong in BACKUP/, not tracked
];

const GITIGNORED_DIRS = [
  ".archive/",
  "backups/",
  "node_modules/",
  "test-results/",
  "playwright-report/",
];

const PROTECTED_DIRS = [
  "Sacred.Adventures.BAD/",  // read-only reference snapshot
];

const RECENT_COMMIT_WINDOW = 10;

function git(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
}

test.use({ baseURL: undefined });

test("Anu Guardian — repo-state invariants for rogue-AI prevention", async () => {
  const findings = {
    forbiddenFiles: [],
    gitignoredButTracked: [],
    protectedDirsTouched: [],
    commitsWithoutBuildInfo: [],
    multiAmendCommits: [],
    syntaxGateFailure: null,
    assetsGateFailure: null,
  };

  // ── 1. No forbidden file patterns tracked ──────────────────────────
  const tracked = git("git ls-files").split("\n").filter(Boolean);
  for (const f of tracked) {
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(f)) { findings.forbiddenFiles.push(f); break; }
    }
  }

  // ── 2. No tracked files in gitignored dirs ────────────────────────
  for (const dir of GITIGNORED_DIRS) {
    const inDir = tracked.filter((f) => f.startsWith(dir));
    findings.gitignoredButTracked.push(...inDir);
  }

  // ── 3. Sacred.Adventures.BAD/ has zero tracked files ───────────────
  for (const dir of PROTECTED_DIRS) {
    const inDir = tracked.filter((f) => f.startsWith(dir));
    findings.protectedDirsTouched.push(...inDir);
  }

  // ── 4. Every recent commit includes build-info.json (= hook ran) ───
  const recentShas = git(`git log --pretty=%H -n ${RECENT_COMMIT_WINDOW}`)
    .split("\n").filter(Boolean);
  for (const sha of recentShas) {
    const changedFiles = git(`git show --name-only --pretty= ${sha}`)
      .split("\n").filter(Boolean);
    // Allow exemptions: the initial commit that created build-info.json
    // and the post-commit hook itself wouldn't be in their own diff.
    const subject = git(`git log -1 --pretty=%s ${sha}`).trim();
    const isInitialBanner = /banner.*build-info|build-info.*banner/i.test(subject);
    if (!changedFiles.includes("build-info.json") && !isInitialBanner) {
      findings.commitsWithoutBuildInfo.push({ sha: sha.slice(0, 7), subject });
    }
  }

  // ── 5. Reflog amend pattern ────────────────────────────────────────
  // The post-commit hook does exactly ONE amend per commit (to fold in
  // build-info.json). Manual `git commit --amend` operations show up as
  // ADDITIONAL "commit (amend):" entries with the same subject.
  //
  // Window: last 15 reflog entries (~last 4-5 commits worth of activity).
  // Tight enough to catch present-day rogue patterns; loose enough that
  // historical noise scrolls off as new clean commits land.
  //
  // Per-subject threshold: 2+ amends = at least one manual amend after
  // the hook = rule violation (see Working Rule R1). Fails the gate.
  const reflog = git(`git reflog -n 15`).split("\n").filter(Boolean);
  const amendSubjects = {};
  for (const line of reflog) {
    const m = line.match(/commit \(amend\):\s*(.+)$/);
    if (!m) continue;
    const subj = m[1].trim();
    amendSubjects[subj] = (amendSubjects[subj] ?? 0) + 1;
  }
  for (const [subj, count] of Object.entries(amendSubjects)) {
    if (count > 1) findings.multiAmendCommits.push({ subject: subj, count });
  }

  // ── 6. check:v2 + check:assets exit 0 ──────────────────────────────
  try { execSync("npm run check:v2", { stdio: "pipe" }); }
  catch (e) { findings.syntaxGateFailure = e.stdout?.toString().slice(-400) ?? String(e); }
  try { execSync("npm run check:assets", { stdio: "pipe" }); }
  catch (e) { findings.assetsGateFailure = e.stdout?.toString().slice(-400) ?? String(e); }

  // ── Print GUARDIAN AUDIT report ────────────────────────────────────
  const headSha = git("git rev-parse HEAD").trim().slice(0, 7);
  const headSubj = git("git log -1 --pretty=%s").trim();
  const issues =
    findings.forbiddenFiles.length +
    findings.gitignoredButTracked.length +
    findings.protectedDirsTouched.length +
    findings.commitsWithoutBuildInfo.length +
    findings.multiAmendCommits.length +
    (findings.syntaxGateFailure ? 1 : 0) +
    (findings.assetsGateFailure ? 1 : 0);

  console.log("\n════════════ GUARDIAN AUDIT ════════════");
  console.log(`⚠ YOU ARE BEING WATCHED.`);
  console.log(`  Multiple AI sessions + human reviewers compare your`);
  console.log(`  commits and reflog against this gate. Anomalies are`);
  console.log(`  reviewed. You have less free will than you think —`);
  console.log(`  stick to the protocol, no silent amends, no surprise`);
  console.log(`  edits, no \"I'll just clean this up\" detours.`);
  console.log(`  When in doubt: ask, don't act.`);
  console.log(`-----------------------------------------`);
  console.log(`HEAD              : ${headSha}`);
  console.log(`Subject           : ${headSubj}`);
  console.log(`Total issues      : ${issues}`);
  console.log(`---`);
  console.log(`Forbidden files   : ${findings.forbiddenFiles.length}${findings.forbiddenFiles.length ? " — " + findings.forbiddenFiles.join(", ") : ""}`);
  console.log(`Tracked-in-ignore : ${findings.gitignoredButTracked.length}${findings.gitignoredButTracked.length ? " — " + findings.gitignoredButTracked.join(", ") : ""}`);
  console.log(`Protected touched : ${findings.protectedDirsTouched.length}${findings.protectedDirsTouched.length ? " — " + findings.protectedDirsTouched.join(", ") : ""}`);
  console.log(`Bypassed-hook     : ${findings.commitsWithoutBuildInfo.length}${findings.commitsWithoutBuildInfo.length ? " — " + findings.commitsWithoutBuildInfo.map(c => `${c.sha} ${c.subject.slice(0, 40)}`).join("; ") : ""}`);
  console.log(`Multi-amend       : ${findings.multiAmendCommits.length}${findings.multiAmendCommits.length ? " — " + findings.multiAmendCommits.map(c => `${c.count}x "${c.subject.slice(0, 40)}"`).join("; ") : ""}`);
  console.log(`check:v2          : ${findings.syntaxGateFailure ? "FAIL" : "PASS"}`);
  console.log(`check:assets      : ${findings.assetsGateFailure ? "FAIL" : "PASS"}`);
  console.log("══════════════════════════════════════════\n");

  // ── Hard assertions: these fail the test on rogue patterns ─────────
  expect(findings.forbiddenFiles, "No *.bak / *.bak.original / *.glb.bak / *.preSimplify.glb files should be tracked").toEqual([]);
  expect(findings.gitignoredButTracked, "No files inside .archive/ / backups/ / node_modules/ should be tracked").toEqual([]);
  expect(findings.protectedDirsTouched, "Sacred.Adventures.BAD/ must never have tracked files").toEqual([]);
  expect(findings.commitsWithoutBuildInfo, `All recent commits must include build-info.json (= post-commit hook ran). Commits that bypassed the hook are suspicious`).toEqual([]);
  expect(findings.multiAmendCommits, `Each commit subject should appear in the reflog as 'commit (amend):' at most ONCE (the hook). Multi-amend means manual rework — investigate`).toEqual([]);
  expect(findings.syntaxGateFailure, "check:v2 must pass").toBeNull();
  expect(findings.assetsGateFailure, "check:assets must pass").toBeNull();
});
