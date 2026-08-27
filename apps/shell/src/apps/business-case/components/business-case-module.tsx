"use client";

/**
 * The module shell: sub-tabs across the top, one store beneath both.
 *
 * The output tab is gated until every required question is answered. That is not
 * decoration — a case rendered from a half-filled form produces numbers that look
 * exactly as confident as a finished one, and the register is the part of this model
 * where a missing row is least visible.
 */

import { useState } from "react";

import { CaseStoreProvider, useCaseStore } from "../hooks/use-case-store";
import { AnalysisWorkspace } from "./analysis-workspace";
import { BusinessCaseWorkspace } from "./business-case-workspace";
import { CapacityWorkspace } from "./capacity-workspace";
import { InputsWorkspace } from "./inputs/inputs-workspace";

type TabKey = "inputs" | "case" | "analysis";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "inputs", label: "Input" },
  { key: "case", label: "Business case" },
  { key: "analysis", label: "Analysis" },
];

export function BusinessCaseModule({
  projectId,
  asOfDate,
}: {
  projectId: string;
  asOfDate: string;
}) {
  return (
    <CaseStoreProvider projectId={projectId} asOfDate={asOfDate}>
      <Tabs projectId={projectId} />
    </CaseStoreProvider>
  );
}

function Tabs({ projectId }: { projectId: string }) {
  const { readiness, generated, workingCase } = useCaseStore();
  const [tab, setTab] = useState<TabKey>(generated ? "case" : "inputs");

  // Falling back rather than rendering an unbuildable case: if the user removes an
  // answer after generating, the output tabs stop being a place they can sit. Analysis is
  // gated on the same set — it reads the same register, so a half-filled one would give it
  // frontiers computed from requirements nobody has supplied.
  const outputAvailable = generated && readiness.canGenerate;
  const showing: TabKey = tab !== "inputs" && !outputAvailable ? "inputs" : tab;

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Business case sections"
        className="flex flex-wrap gap-1 rounded-full bg-panel p-1"
      >
        {TABS.map((entry) => {
          const disabled = entry.key !== "inputs" && !outputAvailable;
          const active = showing === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => setTab(entry.key)}
              title={
                disabled
                  ? generated
                    ? "An answer the case depends on has been removed. Complete it to return here."
                    : "Answer the required questions, then press Generate business case."
                  : undefined
              }
              className={
                active
                  ? "rounded-full bg-white px-5 py-2 text-sm font-bold text-ink shadow-ambient"
                  : "rounded-full px-5 py-2 text-sm font-semibold text-muted transition hover:text-ink disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:text-slate-300"
              }
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {showing === "inputs" ? (
        <InputsWorkspace onGenerated={() => setTab("case")} />
      ) : showing === "analysis" ? (
        <AnalysisWorkspace />
      ) : workingCase.model === "capacity" ? (
        // Its own output rather than the register view with capacity bolted on: a capacity
        // case has no volume or headcount per row, so that view would be a table of blanks
        // sitting next to a correct answer.
        <CapacityWorkspace />
      ) : (
        <BusinessCaseWorkspace projectId={projectId} />
      )}
    </div>
  );
}
