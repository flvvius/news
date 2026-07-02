import { defineConfig } from "vitest/config";

// Native unit tests cover pure lib logic (no RN components), with native
// modules like expo-file-system mocked per-test. Node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "contexts/**/*.test.ts"],
  },
});
