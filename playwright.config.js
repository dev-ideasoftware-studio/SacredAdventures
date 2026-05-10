const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8100",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--use-angle=metal"],
    },
  },
  webServer: {
    command: "python3 -m http.server 8100",
    url: "http://127.0.0.1:8100",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
