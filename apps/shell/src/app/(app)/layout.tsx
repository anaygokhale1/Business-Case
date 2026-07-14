import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { NextChromeRouterProvider } from "@ssa/ui/router-adapter.next";

import { AccessProvider } from "@/components/access-provider";
import { ProjectPortfolioProvider } from "@/components/project-portfolio-provider";
import { ShellChromeDataProvider } from "@/components/shell-chrome-data-provider";
import { getCurrentUser } from "@/lib/auth/session";

// PHASE-3: in real SSA Pro this gate redirects unauthenticated users to /login.
// Here getCurrentUser() always returns the static Demo User, so the guard never
// fires; it is kept so the auth seam is visible.
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user || user.status !== "ACTIVE") {
    redirect("/");
  }

  return (
    <AccessProvider>
      <ProjectPortfolioProvider>
        <NextChromeRouterProvider>
          <ShellChromeDataProvider>{children}</ShellChromeDataProvider>
        </NextChromeRouterProvider>
      </ProjectPortfolioProvider>
    </AccessProvider>
  );
}
