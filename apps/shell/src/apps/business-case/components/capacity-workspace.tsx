"use client";

/**
 * The output for a capacity case.
 *
 * A capacity case answers a different question from a reduction case, so it gets its own
 * output rather than the register view with the capacity numbers bolted on. The register
 * view is built around volume and headcount per row; a capacity case has neither, and
 * rendering it would show a table of blanks beside a correct answer.
 *
 * Money appears only once a cost per role has been entered. Showing a $0 saving because
 * nobody has supplied costs yet reads as "no opportunity" rather than "no data", which is
 * the more damaging of the two misreadings.
 */

import { useMemo } from "react";

import { useCaseStore } from "../hooks/use-case-store";
import { isMissing } from "../lib/engine/alg";
import { valueCapacity } from "../lib/engine/capacity-value";
import { effectiveCostInputs } from "../lib/engine/drivers";
import { count, currency, fte, months } from "../lib/format";
import { CapacityByRole } from "./capacity-by-role";

export function CapacityWorkspace() {
  const { workingCase } = useCaseStore();
  const capacity = workingCase.capacity;

  const transactions = useMemo(
    () =>
      (capacity?.demand ?? []).reduce(
        (total, cell) => total + (typeof cell.submissions === "number" ? cell.submissions : 0),
        0,
      ),
    [capacity],
  );

  if (!capacity) {
    return (
      <div className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <p className="text-sm text-muted">
          No capacity study loaded. Upload a time study and a volumes study in the Input tab.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-[32px] bg-white/95 p-8 shadow-ambient ring-1 ring-slate-200/70">
        <h1 className="text-2xl font-extrabold text-ink">
          {workingCase.meta.initiativeTitle || "Capacity optimisation"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {workingCase.meta.company}
          {workingCase.meta.coreProblem ? ` · ${workingCase.meta.coreProblem}` : ""} &middot;{" "}
          {count(capacity.rows.length)} tasks &middot; {count(transactions)}{" "}
          {workingCase.meta.workloadUnitName.trim() || "transactions"} a year &middot; as at{" "}
          {workingCase.meta.asOfDate}
        </p>
      </header>

      <CapacityByRole capacity={capacity} />

      <Money />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Money() {
  const { workingCase } = useCaseStore();
  const capacity = workingCase.capacity!;
  const costs = effectiveCostInputs(workingCase.globals);

  const valuation = useMemo(
    () =>
      valueCapacity(capacity, {
        severanceWeeks: costs.severanceWeeks,
        includeOneTimeCosts: workingCase.globals.implementationCosts !== "None",
      }),
    [capacity, costs.severanceWeeks, workingCase.globals.implementationCosts],
  );

  const anyCost = capacity.roles.some((r) => typeof r.annualCost === "number");

  if (!anyCost) {
    return (
      <section className="rounded-[32px] bg-canvas p-8 ring-1 ring-slate-200/70">
        <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
          What the move is worth
        </h2>
        <p className="mt-2 text-sm text-muted">
          No cost has been entered against any role, so this case has no money in it yet. Enter an
          all-in annual cost per role in the <strong className="text-ink">Role capacity</strong>{" "}
          step and the saving, the one-time cost and the payback appear here. Nothing is assumed on
          your behalf — there is no defensible industry figure for a role&rsquo;s all-in cost, and a
          plausible one would be the most quietly damaging number in the case.
        </p>
      </section>
    );
  }

  const items = [
    {
      label: valuation.grossAnnualSaving >= 0 ? "Gross annual saving" : "Gross annual increase",
      value: currency(Math.abs(valuation.grossAnnualSaving)),
    },
    { label: "One-time cost", value: currency(valuation.oneTimeCost) },
    { label: "Simple payback", value: months(valuation.paybackMonths) },
    {
      label: "On whole FTE",
      value: currency(Math.abs(valuation.grossAnnualSavingWhole)),
    },
  ];

  return (
    <section className="space-y-5 rounded-[32px] bg-ink p-8 text-white shadow-ambient">
      <div>
        <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
          What the move is worth
        </h2>
        <p className="mt-1 text-sm text-white/70">
          The role mix above, costed at each role&rsquo;s own all-in rate and location.{" "}
          {valuation.currency}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl bg-white/10 px-4 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-extrabold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/70">
        {fte(valuation.fteOut, 2)} FTE of requirement leaves shrinking roles and{" "}
        {fte(valuation.fteIn, 2)} joins growing ones.{" "}
        {valuation.redeployedFte > 0
          ? `${fte(valuation.redeployedFte, 2)} is absorbed by redeployment, leaving ${fte(valuation.exitingFte, 2)} exiting and ${fte(valuation.unfilledFte, 2)} to recruit.`
          : `With no redeployment assumed, all ${fte(valuation.exitingFte, 2)} exits and all ${fte(valuation.unfilledFte, 2)} is recruited.`}{" "}
        {/* The whole-FTE figure is computed from independently rounded sides, so it is not
            a rounding of the fractional one and the two can differ by a whole person. */}
        The whole-FTE figure rounds each side up separately rather than rounding the difference.
      </p>

      {valuation.rolesWithoutCost.length > 0 ? (
        <p className="rounded-2xl bg-white/10 px-4 py-3 text-xs text-white/80">
          <strong>Not in these figures:</strong> {valuation.rolesWithoutCost.join(", ")} — no cost
          entered, so {valuation.rolesWithoutCost.length === 1 ? "it is" : "they are"} excluded.
          That hides {fte(Math.abs(valuation.uncostedFteChange), 2)} FTE of change. Omitting a
          growing role&rsquo;s cost makes the saving look larger, so this would not fail a
          sense-check on its own.
        </p>
      ) : null}

      {isMissing(valuation.paybackMonths) && valuation.oneTimeCost > 0 ? (
        <p className="text-xs text-white/70">
          There is no payback: the reallocation does not reduce annual cost, so the one-time cost
          is never recovered from it.
        </p>
      ) : null}
    </section>
  );
}
