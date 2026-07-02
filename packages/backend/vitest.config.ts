import { defineConfig } from "vitest/config";

// Convex backend unit tests run on the edge runtime convex-test targets, with
// env vars stubbed so importing function modules (several read auth/email
// config at module load) never throws during test collection.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
