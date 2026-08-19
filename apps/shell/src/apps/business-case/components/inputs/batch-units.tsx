"use client";

import { useCaseStore } from "../../hooks/use-case-store";
import type { AnswerStatus } from "../../lib/case-questions";
import type { Driver } from "../../lib/engine/types";
import { SENTINEL } from "../../lib/engine/types";
import { Note, NumberInput, Panel } from "./fields";
import { UnitGrid, type UnitColumn } from "./unit-grid";

/** Batch 4 — Q11, Q12. Current FTE by role for every row. */
export function BatchUnits({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const { roles, units } = workingCase;

  const columns: UnitColumn[] = roles.map((role) => ({
    key: role.id,
    label: `${role.title || role.id} FTE`,
    questionId: role.tier === "front-line" ? "Q11" : role.tier === "manager" ? "Q12" : undefined,
    align: "right",
    width: "w-40",
    render: (unit) => (
      <NumberInput
        ariaLabel={`${role.title || role.id} FTE for ${unit.name || unit.id}`}
        value={typeof unit.headcount[role.id] === "number" ? (unit.headcount[role.id] as number) : null}
        onChange={(v) =>
          dispatch({
            type: "unit/setHeadcount",
            unitId: unit.id,
            roleId: role.id,
            // Clearing the box means the row has no such role, which is 0 FTE — not a
            // missing value. Headcount is a count, and an absent count is zero people.
            value: (v === null ? 0 : v) as Driver,
          })
        }
        dp={2}
        placeholder="0"
      />
    ),
  }));

  const frontLine = roles.filter((r) => r.tier === "front-line");
  const totalFrontLine = units.reduce((acc, u) => {
    for (const role of frontLine) {
      const raw = u.headcount[role.id];
      if (typeof raw === "number") acc += raw;
    }
    return acc;
  }, 0);

  return (
    <Panel
      title="Units & headcount"
      blurb={blurb}
      aside={
        <div className="rounded-2xl bg-canvas px-4 py-3 text-right">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
            Front-line FTE
          </p>
          <p className="text-xl font-extrabold tabular-nums text-ink">
            {totalFrontLine.toLocaleString("en-US")}
          </p>
        </div>
      }
    >
      <div className="space-y-5">
        <UnitGrid
          columns={columns}
          showAddRow
          emptyMessage="Add a region in the Scope step first — every row belongs to one."
        />

        {status["Q11"] === "empty" && units.length > 0 ? (
          <Note>
            Every row needs a front-line FTE figure. A row left blank counts as zero staff, which
            quietly shrinks the population the whole case is computed over.
          </Note>
        ) : null}

        <Note>
          Rows can be split as finely as the data allows — one per region, or one per team within a
          region. Finer rows are strictly better: a team at 60% utilisation and a team at 85% need
          different numbers of people for the same volume, and a single averaged row cannot show
          that. Every portfolio total on the case is the sum of these rows. A missing figure is
          carried as <code className="rounded bg-panel px-1">{SENTINEL}</code> rather than zero, so it
          cannot silently enter a total.
        </Note>
      </div>
    </Panel>
  );
}
