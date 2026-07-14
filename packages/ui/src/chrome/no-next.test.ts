import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Guard: nothing reachable from the @ssa/ui/chrome entry may import next/*.
// The chrome entry is consumed by Vite apps (PMO, Project IQ) where a
// transitive `next` import breaks the build. We walk the full relative-import
// closure starting at src/chrome/index.ts and assert no module in that closure
// contains a `next` / `next/*` import specifier. Package imports other than
// relative paths (e.g. "react") are not followed — only first-party sources.

const SRC_ROOT = join(process.cwd(), "src");
const ENTRY = join(SRC_ROOT, "chrome", "index.ts");

// Any ESM/CJS import whose specifier is exactly `next` or starts with `next/`.
const NEXT_IMPORT = /(?:import|export)[^;]*?from\s*["'](next(?:\/[^"']*)?)["']|require\s*\(\s*["'](next(?:\/[^"']*)?)["']\s*\)/;

// Match relative import/export specifiers so we can follow the closure.
const REL_SPECIFIER = /(?:import|export)[^;]*?from\s*["'](\.[^"']*)["']|require\s*\(\s*["'](\.[^"']*)["']\s*\)/g;

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx"];

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates: string[] = [];
  for (const ext of RESOLVE_EXTS) candidates.push(base + ext);
  for (const ext of RESOLVE_EXTS) candidates.push(join(base, "index" + ext));
  if (existsSync(base) && readdirSync(dirname(base)).length >= 0) {
    // If the specifier already points at a concrete file, prefer it.
    if (RESOLVE_EXTS.some((ext) => base.endsWith(ext)) && existsSync(base)) {
      candidates.unshift(base);
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectClosure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(REL_SPECIFIER)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const resolved = resolveModule(file, spec);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return [...seen];
}

describe("@ssa/ui/chrome no-next guard", () => {
  it("chrome entry exists", () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  it("no module reachable from the chrome entry imports next / next/*", () => {
    const closure = collectClosure(ENTRY).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    const offenders = closure.filter((file) => NEXT_IMPORT.test(readFileSync(file, "utf8")));
    expect(offenders, `next/* imported by: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no file directly under src/chrome/ imports next / next/*", () => {
    const chromeDir = join(SRC_ROOT, "chrome");
    const files = readdirSync(chromeDir)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
      .map((name) => join(chromeDir, name));
    const offenders = files.filter((file) => NEXT_IMPORT.test(readFileSync(file, "utf8")));
    expect(offenders, `next/* imported by: ${offenders.join(", ")}`).toEqual([]);
  });
});
