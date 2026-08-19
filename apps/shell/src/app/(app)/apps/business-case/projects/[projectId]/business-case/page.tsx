"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

import { ModuleGate } from "@ssa/ui/module-gate";

// Same mounting shape as the reference module: the workspace is loaded client-side
// and wrapped in <ModuleGate>, which blocks the module unless it is enabled for
// this project. The engine is pure client-side computation, so there is nothing to
// render on the server.
const BusinessCaseWorkspace = dynamic(
  () =>
    import("@/apps/business-case/components/business-case-workspace").then(
      (mod) => mod.BusinessCaseWorkspace
    ),
  { ssr: false }
);

export default function BusinessCasePage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <ModuleGate projectId={projectId} moduleKey="businessCase">
      <BusinessCaseWorkspace projectId={projectId} />
    </ModuleGate>
  );
}
