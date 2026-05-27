/**
 * v4-build-badge.spec.js
 *
 * Verifies the bottom-left build banner mounts on boot and reflects the
 * subject + branch + sw version + dirty flag from build-info.json.
 */
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

test("build badge renders + matches build-info.json", async ({ page }) => {
  const info = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "build-info.json"), "utf8")
  );

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const badge = page.locator("#build-badge");
  await expect(badge).toBeVisible({ timeout: 8000 });

  const text = (await badge.textContent()).trim();
  console.log("[build-badge text]", text);

  expect(text).toContain(info.branch);
  expect(text).toContain(info.subject.slice(0, 20));
  if (info.swVersion) expect(text).toContain(`sw ${info.swVersion}`);
  if (info.dirty) expect(text.toUpperCase()).toContain("UNCOMMITTED");

  const box = await badge.boundingBox();
  console.log("[build-badge box]", JSON.stringify(box));
  expect(box.x).toBeLessThan(50);
  expect(box.y).toBeGreaterThan(600);
});
