// Vite-safe, router-agnostic chrome entry (@ssa/ui/chrome).
//
// Every component here reads Link/usePathname/navigate from an injected
// RouterAdapter via useRouterAdapter() — NONE import next/*. Consumers wrap the
// chrome tree in <ChromeRouterProvider adapter={...}>: the shell supplies a
// next/link-backed adapter (@ssa/ui/router-adapter.next), the Vite apps supply
// a react-router-dom-backed adapter. The no-next guard test asserts nothing
// transitively reachable from this entry imports next.

export {
  ChromeRouterProvider,
  useRouterAdapter,
  type RouterAdapter,
  type LinkProps,
} from "../router-adapter";

export { AppShell } from "./app-shell";
export { ProjectSwitcher } from "./project-switcher";
export { ProjectNav } from "./project-nav";
export { PageShell } from "./page-shell";
export { NavigationProgress } from "./navigation-progress";
export { InvalidProjectState } from "./invalid-project-state";
