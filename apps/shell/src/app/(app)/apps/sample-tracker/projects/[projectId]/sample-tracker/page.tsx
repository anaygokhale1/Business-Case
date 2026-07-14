"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

import { ModuleGate } from "@ssa/ui/module-gate";

// The module UI is loaded client-side and wrapped in <ModuleGate>, which blocks
// the module unless it is enabled for this project. This is exactly how in-shell
// modules mount in real SSA Pro.
const SampleTrackerWorkspace = dynamic(
  () =>
    import("@/apps/sample-tracker/components/sample-tracker-workspace").then(
      (mod) => mod.SampleTrackerWorkspace
    ),
  { ssr: false }
);

export default function SampleTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <ModuleGate projectId={projectId} moduleKey="sampleTracker">
      <SampleTrackerWorkspace projectId={projectId} />
    </ModuleGate>
  );
}
