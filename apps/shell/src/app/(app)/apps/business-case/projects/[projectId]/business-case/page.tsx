"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ModuleGate } from "@ssa/ui/module-gate";

// Same mounting shape as the reference module: the workspace is loaded client-side
// and wrapped in <ModuleGate>, which blocks the module unless it is enabled for
// this project. The engine is pure client-side computation, so there is nothing to
// render on the server.
const BusinessCaseModule = dynamic(
  () =>
    import("@/apps/business-case/components/business-case-module").then(
      (mod) => mod.BusinessCaseModule
    ),
  { ssr: false }
);

/**
 * G20 — this is the one place the clock is read.
 *
 * A new case is stamped with today's date and every calculation downstream reads
 * that stamp instead of the clock, so a model does not quietly produce different
 * numbers tomorrow. Held in state so a re-render cannot re-stamp it mid-session.
 */
function useAsOfDate(): string {
  const [asOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  return asOfDate;
}

export default function BusinessCasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const asOfDate = useAsOfDate();

  return (
    <ModuleGate projectId={projectId} moduleKey="businessCase">
      <BusinessCaseModule projectId={projectId} asOfDate={asOfDate} />
    </ModuleGate>
  );
}
