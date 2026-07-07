import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";

// Component tests run against jsdom without the TanStack Start / Nitro
// plugins from vite.config.ts — those target the full app server and break
// under vitest.
export default defineConfig({
  plugins: [tsconfigPaths(), viteReact()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
