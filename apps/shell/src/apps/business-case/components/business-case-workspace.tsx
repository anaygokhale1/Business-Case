"use client";

import { useMemo, useState } from "react";

import { useCaseStore } from "../hooks/use-case-store";
import { isMissing } from "../lib/engine/alg";
import { checkInvariants } from "../lib/engine/qc";
import { resolve, resolveAll } from "../lib/engine/scenario";
import type { ScenarioKey } from "../lib/engine/types";
import { SCENARIO_KEYS } from "../lib/engine/types";
import { count, currency, currencyCompact, fte, minutes, months, pct } from "../lib/format";
import type { RegisterColumn, RegisterRow } from "../lib/register-sort";
import { useRegisterSort } from "../hooks/use-register-sort";

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  low: "Low",
  base: "Base",
  high: "High",
};

const COLUMNS: Array<{ key: RegisterColumn; label: string; numeric: boolean }> = [
  { key: "name", label: "Unit", numeric: false },
  { key: "region", label: "Region", numeric: false },
  { key: "currentFrontLine", label: "Current FTE", numeric: true },
  { key: "handleTimeMinutes", label: "Handle time", numeric: true },
  { key: "effectiveHours", label: "Effective hrs", numeric: true },
  { key: "requiredFrontLine", label: "Required FTE", numeric: true },
  { key: "surplus", label: "Surplus / (deficit)", numeric: true },
];

// A value the unit supplied itself reads solid; one inherited from the global
// assumption reads muted. This is the same `origin` metadata the drill-down trace
// uses, so the badge and the explanation can never disagree.
const originClass = (origin: string) =>
  origin === "own" ? "font-semibold text-ink" : "text-outline";

const originTitle = (origin: string) =>
  origin === "own"
    ? "Supplied by this unit"
    : origin === "missing"
      ? "Not supplied — excluded from totals"
      : "Inherited from the global assumption";

export function BusinessCaseWorkspace({ projectId }: { projectId: string }) {
  // The case comes from the store the input form writes to, so the output is a view
  // of the answers rather than a second copy of them. Nothing is written to the
  // database until the user explicitly saves.
  const { workingCase: businessCase } = useCaseStore();
  const [scenario, setScenario] = useState<ScenarioKey>("base");

  const all = useMemo(() => resolveAll(businessCase), [businessCase]);
  const result = all[scenario];
  const violations = useMemo(() => checkInvariants(businessCase), [businessCase]);

  const rows: RegisterRow[] = useMemo(
    () =>
      result.units.map((unit) => ({
        ...unit,
        name: businessCase.units.find((u) => u.id === unit.unitId)?.name ?? unit.unitId,
      })),
    [result, businessCase],
  );

  const { sorted, column, dir, toggle } = useRegisterSort(rows);

  const kpis = [
    { label: "Total FTE reduction", value: fte(result.totalReduction) },
    { label: "Gross annual savings", value: currency(result.grossSavings) },
    { label: "One-time cost", value: currency(result.oneTimeCost) },
    { label: "Year 1 net benefit", value: currency(result.year1Net) },
    { label: "Simple payback", value: months(result.paybackMonths) },
    {
      // G19 — the label is built from the horizon, never written as "3-Year".
      label: `${result.horizonYears}-year net savings`,
      value: currency(result.horizonNet),
    },
  ];

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warn");

  return (
    <div className="space-y-6">
      {/* ---------------- header + scenario switch ---------------- */}
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-extrabold text-ink">
              {businessCase.meta.initiativeTitle}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {businessCase.meta.company} &middot; {businessCase.meta.coreProblem} &middot;{" "}
              {businessCase.units.length} units &middot; as at {businessCase.meta.asOfDate}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Scenario
            </span>
            {SCENARIO_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setScenario(key)}
                aria-pressed={scenario === key}
                className={
                  scenario === key
                    ? "rounded-full bg-ink px-4 py-2 text-sm font-bold text-white"
                    : "rounded-full border border-slate-200 bg-canvas px-4 py-2 text-sm font-semibold text-muted transition hover:border-ink/40 hover:text-ink"
                }
              >
                {SCENARIO_LABEL[key]} &middot; {pct(all[key].hcReductionPct, 0)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-2xl bg-canvas p-4 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                {kpi.label}
              </p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{kpi.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- model checks ---------------- */}
      {violations.length > 0 ? (
        <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-outline">
            Model checks
          </h2>
          <p className="mt-1 text-sm text-muted">
            {errors.length} blocking, {warnings.length} advisory. A blocking check stops the
            workbook from being exported rather than shipping a confident-looking number.
          </p>
          <ul className="mt-4 space-y-2">
            {[...errors, ...warnings].map((violation, index) => (
              <li
                key={`${violation.id}-${index}`}
                className="flex gap-3 rounded-2xl bg-canvas px-4 py-3 text-sm"
              >
                <span
                  className={
                    violation.severity === "error"
                      ? "shrink-0 font-extrabold text-red-600"
                      : "shrink-0 font-extrabold text-outline"
                  }
                >
                  {violation.id}
                </span>
                <span className="text-muted">{violation.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---------------- scenario contrast ---------------- */}
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h2 className="text-lg font-extrabold text-ink">All three scenarios</h2>
        <p className="mt-1 text-sm text-muted">
          Shown side by side rather than one at a time, so the question is which numbers are
          robust to the assumption and which move.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Metric
                </th>
                {SCENARIO_KEYS.map((key) => (
                  <th
                    key={key}
                    className={
                      key === scenario
                        ? "px-5 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink"
                        : "px-5 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline"
                    }
                  >
                    {SCENARIO_LABEL[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Headcount reduction", (r: typeof result) => pct(r.hcReductionPct, 0)],
                  ["Front-line FTE out", (r: typeof result) => fte(r.staffReduction)],
                  ["Manager FTE out", (r: typeof result) => fte(r.managers.managerReduction)],
                  ["Gross annual savings", (r: typeof result) => currencyCompact(r.grossSavings)],
                  ["One-time cost", (r: typeof result) => currencyCompact(r.oneTimeCost)],
                  ["Year 1 net", (r: typeof result) => currencyCompact(r.year1Net)],
                  ["Simple payback", (r: typeof result) => months(r.paybackMonths)],
                ] as const
              ).map(([label, read]) => (
                <tr key={label} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-semibold text-ink">{label}</td>
                  {SCENARIO_KEYS.map((key) => (
                    <td
                      key={key}
                      className={
                        key === scenario
                          ? "px-5 py-3 text-right font-bold tabular-nums text-ink"
                          : "px-5 py-3 text-right tabular-nums text-muted"
                      }
                    >
                      {read(all[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- register ---------------- */}
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-ink">Unit register</h2>
            <p className="mt-1 text-sm text-muted">
              Required FTE is computed against each unit&rsquo;s own effective hours, and the
              portfolio total is the sum of these rows &mdash; never a portfolio volume divided by
              an average.
            </p>
          </div>
          <p className="text-xs text-outline">
            <span className="font-semibold text-ink">Solid</span> = supplied by the unit,{" "}
            <span className="text-outline">muted</span> = inherited from the global assumption
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {COLUMNS.map((col) => (
                  <th key={col.key} className={col.numeric ? "px-5 py-3 text-right" : "px-5 py-3"}>
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={
                        col.numeric
                          ? "ml-auto flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline transition hover:text-ink"
                          : "flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline transition hover:text-ink"
                      }
                    >
                      {col.label}
                      <span aria-hidden className="text-[10px]">
                        {column === col.key ? (dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.unitId} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-semibold text-ink">{row.name}</td>
                  <td className="px-5 py-3 text-muted">{row.region}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink">
                    {count(row.currentFrontLine)}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${originClass(row.handleTimeMinutes.origin)}`}
                    title={originTitle(row.handleTimeMinutes.origin)}
                  >
                    {minutes(row.handleTimeMinutes.value)}
                  </td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${originClass(row.effectiveHours.origin)}`}
                    title={originTitle(row.effectiveHours.origin)}
                  >
                    {count(row.effectiveHours.value)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink">
                    {fte(row.requiredFrontLine)}
                  </td>
                  <td
                    className={
                      isMissing(row.surplus)
                        ? "px-5 py-3 text-right tabular-nums text-outline"
                        : row.surplus >= 0
                          ? "px-5 py-3 text-right font-bold tabular-nums text-teal"
                          : "px-5 py-3 text-right font-bold tabular-nums text-red-600"
                    }
                  >
                    {fte(row.surplus)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Portfolio
                </td>
                <td className="px-5 py-3 text-muted">{sorted.length} units</td>
                <td className="px-5 py-3 text-right font-extrabold tabular-nums text-ink">
                  {count(result.totals.currentFrontLine)}
                </td>
                <td colSpan={2} />
                <td className="px-5 py-3 text-right font-extrabold tabular-nums text-ink">
                  {fte(result.totals.requiredFrontLine)}
                </td>
                <td
                  className={
                    result.totals.surplus >= 0
                      ? "px-5 py-3 text-right font-extrabold tabular-nums text-teal"
                      : "px-5 py-3 text-right font-extrabold tabular-nums text-red-600"
                  }
                >
                  {fte(result.totals.surplus)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-4 text-xs text-outline">
          Managers are sized once at portfolio level, so a per-unit manager figure would be an
          allocation rather than a calculation. Per-unit rounding would require{" "}
          {count(result.managerRoundingDelta)} more manager
          {result.managerRoundingDelta === 1 ? "" : "s"} than the {count(result.managers.requiredManagers)}{" "}
          shown. Project: {projectId}.
        </p>
      </div>
    </div>
  );
}
