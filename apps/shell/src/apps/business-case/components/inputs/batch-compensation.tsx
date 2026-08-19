"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import { BENCHMARK_CAVEAT, benchmarkFor } from "../../lib/case-defaults";
import type { AnswerStatus } from "../../lib/case-questions";
import { computeBlendedCost } from "../../lib/engine/aggregate";
import { indexRoles } from "../../lib/engine/drivers";
import { isMissing } from "../../lib/engine/alg";
import { currency } from "../../lib/format";
import { ghostButtonClass, Note, NumberInput, Panel } from "./fields";
import { UnitGrid, type UnitColumn } from "./unit-grid";

/** Batch 5 — Q15, Q16. All-in annual cost per FTE, per row. */
export function BatchCompensation({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { roles, meta } = workingCase;
  const bench = benchmarkFor(meta.industry);

  const columns: UnitColumn[] = roles.map((role) => ({
    key: role.id,
    label: `${role.title || role.id} $/yr`,
    questionId: role.tier === "front-line" ? "Q15" : role.tier === "manager" ? "Q16" : undefined,
    align: "right",
    width: "w-44",
    render: (unit) => (
      <NumberInput
        ariaLabel={`${role.title || role.id} cost for ${unit.name || unit.id}`}
        value={typeof unit.cost[role.id] === "number" ? (unit.cost[role.id] as number) : null}
        onChange={(v) =>
          dispatch({
            type: "unit/setCost",
            unitId: unit.id,
            roleId: role.id,
            // Cleared means unknown, not free. A zero cost would understate the blended
            // figure while keeping the FTE in the denominator.
            value: v === null ? "n/a" : v,
          })
        }
        dp={2}
        placeholder="—"
      />
    ),
  }));

  const allIn = computeBlendedCost(workingCase, indexRoles(roles).all);

  return (
    <Panel
      title="Compensation"
      blurb={blurb}
      aside={
        <div className="rounded-2xl bg-canvas px-4 py-3 text-right">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Blended all-in
          </p>
          <p className="text-xl font-extrabold tabular-nums text-ink">
            {isMissing(allIn.value) ? "n/a" : currency(allIn.value)}
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        {bench ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas px-4 py-3">
            <div className="text-xs text-muted">
              <span className="font-semibold text-ink">{meta.industry}</span> placeholder:{" "}
              {currency(bench.frontLine)} front-line, {currency(bench.manager)} manager.
            </div>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => dispatch({ type: "benchmark/applyCompensation" })}
              title="Fills empty boxes only. A figure you typed is never overwritten."
            >
              Fill the gaps
            </button>
          </div>
        ) : null}

        <UnitGrid
          columns={columns}
          emptyMessage="Add a region in the Scope step first — cost is captured per row."
        />

        {allIn.dropped > 0 ? (
          <Note>
            <span className="font-semibold text-red-600">
              {allIn.dropped} row-and-role combination{allIn.dropped === 1 ? "" : "s"} still has no
              cost.
            </span>{" "}
            The blended figure above covers only the rows that do. This blocks the Excel export
            outright: a spreadsheet reads an empty cost as zero inside a SUMPRODUCT while keeping the
            headcount in the divisor, so the workbook would report a confidently low cost per FTE with
            no error showing anywhere.
          </Note>
        ) : null}

        {bench ? <Note>{BENCHMARK_CAVEAT}</Note> : null}

        <Note>
          Blended cost is the headcount-weighted average — total payroll divided by total FTE — never
          total savings divided by the number of people leaving. The two agree only when the roles
          being removed have exactly the same cost mix as the organisation as a whole, which is almost
          never true, and severance is computed off this figure.
        </Note>
      </div>
    </Panel>
  );
}
