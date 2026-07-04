import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PW_BASE_URL ?? "http://localhost:3001";

// E2E tests run against the Vite dev server (reused locally if already
// running) backed by the Convex dev deployment. The environment must provide
// VITE_CONVEX_URL and the deployment at least one clustered event (specs
// navigate the real feed); beyond that, specs assert structural invariants
// (layout, scroll, overflow), never specific content.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // 390x844 = iPhone 12/13/14 CSS viewport, the primary mobile target
      // for BIV-810/811.
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
