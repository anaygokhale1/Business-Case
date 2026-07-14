import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  ChromeRouterProvider,
  useRouterAdapter,
  type RouterAdapter,
} from "./router-adapter";

function makeAdapter(): RouterAdapter {
  return {
    Link: ({ href, className, children }) => (
      <a href={href} className={className}>
        {children}
      </a>
    ),
    usePathname: () => "/current",
    navigate: () => {},
  };
}

describe("useRouterAdapter", () => {
  it("throws a clear error when used outside ChromeRouterProvider", () => {
    expect(() => renderHook(() => useRouterAdapter())).toThrow(
      /ChromeRouterProvider/,
    );
  });

  it("returns the exact adapter passed to the provider (identity preserved)", () => {
    const adapter = makeAdapter();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ChromeRouterProvider adapter={adapter}>{children}</ChromeRouterProvider>
    );

    const { result } = renderHook(() => useRouterAdapter(), { wrapper });

    expect(result.current).toBe(adapter);
    expect(result.current.Link).toBe(adapter.Link);
    expect(result.current.usePathname).toBe(adapter.usePathname);
    expect(result.current.navigate).toBe(adapter.navigate);
  });

  it("renders the provided Link with its href/className/children", () => {
    const adapter = makeAdapter();
    function Consumer() {
      const { Link } = useRouterAdapter();
      return (
        <Link href="/dashboard" className="nav">
          Dashboard
        </Link>
      );
    }

    const { getByRole } = render(
      <ChromeRouterProvider adapter={adapter}>
        <Consumer />
      </ChromeRouterProvider>,
    );

    const link = getByRole("link", { name: "Dashboard" });
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(link.classList.contains("nav")).toBe(true);
  });
});

describe("no-next guard", () => {
  it("router-adapter.tsx contains no next / next/* import specifier", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "router-adapter.tsx"),
      "utf8",
    );
    // Match any ESM/CJS import whose specifier is `next` or starts with `next/`.
    const nextImport =
      /(?:import|from|require\s*\(\s*)["'](next(?:\/[^"']*)?)["']/;
    expect(nextImport.test(source)).toBe(false);
  });
});
