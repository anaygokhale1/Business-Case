import { createContext, useContext } from "react";
import type { ReactNode } from "react";

// Link props: the standard anchor attributes the chrome relies on (className,
// onClick, title, aria-current, ...) plus a required string href + children.
// A concrete adapter Link (next/link, react-router <Link>, or a plain <a>) is
// structurally assignable because each accepts a superset of these props.
export type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

export type RouterAdapter = {
  Link: React.ComponentType<LinkProps>;
  usePathname: () => string;
  navigate: (href: string, opts?: { hard?: boolean }) => void;
};

const RouterAdapterContext = createContext<RouterAdapter | null>(null);

export function ChromeRouterProvider({
  adapter,
  children,
}: {
  adapter: RouterAdapter;
  children: ReactNode;
}) {
  return (
    <RouterAdapterContext.Provider value={adapter}>
      {children}
    </RouterAdapterContext.Provider>
  );
}

export function useRouterAdapter(): RouterAdapter {
  const adapter = useContext(RouterAdapterContext);
  if (adapter === null) {
    throw new Error(
      "useRouterAdapter must be used within a <ChromeRouterProvider>. " +
        "Wrap the chrome root with <ChromeRouterProvider adapter={...}> and " +
        "supply a router-backed adapter (next/link for the shell, " +
        "react-router-dom for Vite apps).",
    );
  }
  return adapter;
}
