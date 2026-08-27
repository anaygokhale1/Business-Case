import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    name: "unit",
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**"],
    // The default 5s is calibrated for unit tests. Several suites here mount the whole
    // business-case module and drive real files and hundreds of events through it, and each
    // event is a full re-render plus a draft write plus an engine recompute. Run alone they
    // finish in under two seconds; in parallel on a loaded machine they cross 5s and a
    // different handful fails on every run. A timeout reported as a failure is worse than a
    // slow test, because it trains you to re-run rather than to read.
    testTimeout: 30_000
  }
});
