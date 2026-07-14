"use client";

// Next.js-backed RouterAdapter. This is the ONLY chrome adapter allowed to
// import next/*; the router-agnostic chrome (packages/ui/src/chrome/*) never
// imports next directly — it reads Link/usePathname/navigate from the injected
// adapter via useRouterAdapter(). The shell wraps its chrome tree in
// <NextChromeRouterProvider> so the shared chrome behaves exactly as it did
// when the components imported next/link + next/navigation themselves.

import NextLink from "next/link";
import { usePathname as useNextPathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ChromeRouterProvider, type RouterAdapter } from "./router-adapter";

// Builds a Next-backed adapter. Must run inside a client component so
// useRouter() resolves the App Router instance for soft navigations. A `hard`
// navigation falls back to a full-page browser assign (used for cross-zone
// /apps/* hops that would 404 under a soft next/link transition).
export function useNextRouterAdapter(): RouterAdapter {
  const router = useRouter();
  return {
    Link: NextLink,
    usePathname: useNextPathname,
    navigate: (href, opts) => {
      if (opts?.hard) {
        window.location.assign(href);
      } else {
        router.push(href);
      }
    },
  };
}

// Convenience provider: builds the Next adapter and supplies it to the chrome.
export function NextChromeRouterProvider({ children }: { children: ReactNode }) {
  const adapter = useNextRouterAdapter();
  return <ChromeRouterProvider adapter={adapter}>{children}</ChromeRouterProvider>;
}
