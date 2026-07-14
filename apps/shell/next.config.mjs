import { fileURLToPath } from "node:url";

// Repo root (two levels up from apps/shell). Pins Next's workspace-root
// inference so a stray lockfile elsewhere on disk can't mislead file tracing.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: repoRoot,
  // Workspace packages ship TypeScript source, so Next transpiles them.
  transpilePackages: ["@ssa/db", "@ssa/project-context", "@ssa/ui", "@ssa/server"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // The shared chrome is bundled from source; keep Node built-ins out of the
      // client bundle.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
        buffer: false,
        crypto: false,
        process: false
      };
    }
    return config;
  }
};

export default nextConfig;
