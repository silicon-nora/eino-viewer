import { defineConfig } from "@playwright/test";

// Data combinations keep every assertion and entry point on Chromium.
// Untagged tests (including new tests) keep three-engine coverage by default.
const crossEngine = process.env.EINO_VIEWER_ALL_ENGINES === "1" ? {} : { grepInvert: /@data-matrix/ };

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  outputDir: process.env.EINO_VIEWER_BROWSER_GUARDED === "1"
    ? process.env.EINO_VIEWER_BROWSER_OUTPUT_DIR || ".artifacts/playwright/browser"
    : ".artifacts/playwright/browser",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    { name: "firefox", ...crossEngine, use: { browserName: "firefox" } },
    { name: "webkit", ...crossEngine, use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1",
    url: "http://127.0.0.1:4173/.artifacts/pages/",
    reuseExistingServer: !process.env.CI && process.env.EINO_VIEWER_BROWSER_GUARDED !== "1",
  },
});
