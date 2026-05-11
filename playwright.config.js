const { defineConfig } = require("@playwright/test");

/**
 * Cursor / CI sandboxes sometimes set PLAYWRIGHT_BROWSERS_PATH to a mac-x64 cache that
 * does not exist on Apple Silicon hosts. Prefer OS-default cache (`0` = ms-playwright per user).
 * Set PW_KEEP_PLAYWRIGHT_BROWSERS_PATH=1 if you intentionally override the browsers path.
 */
(() => {
  if (process.env.PW_KEEP_PLAYWRIGHT_BROWSERS_PATH === "1") return;
  const p = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (
    !p ||
    p.includes("cursor-sandbox-cache") ||
    p.includes(".cursor/")
  ) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
  }
})();

/** Dedicated port — avoids EADDRINUSE when another dev server already uses 8100. */
const PW_PORT = Number(process.env.PW_TEST_PORT || 8765);
const baseURL = `http://127.0.0.1:${PW_PORT}`;

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--use-angle=metal"],
    },
  },
  webServer: {
    command: `python3 -m http.server ${PW_PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
