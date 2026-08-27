"use client";

/**
 * What the stay-or-move decisions add up to, shown where they are made.
 *
 * The Business case tab carries the full version of this. A compact copy belongs here
 * because the decision and its consequence are otherwise two tabs apart: moving one task
 * from an underwriter to an assistant changes required FTE and cost, and if that only
 * appears after pressing Generate the user is guessing while they work.
 *
 * FTE first, money second, and money only once a cost exists. Required FTE needs no cost at
 * all, so it is always available; showing a $0 delta because nobody has entered a rate yet
 * reads as "this move is worth nothing" rather than "we cannot say", and the first of those
 * is the reading that gets a real opportunity dropped.
 */

import { isMissing } from "../../lib/engine/alg";
import { compareCapacity, type RoleDelta } from "../../lib/engine/capacity";
import { valueCapacity } from "../../lib/engine/capacity-value";
import { effectiveCostInputs } from "../../lib/engine/drivers";
import type { CapacityBlock, Globals } from "../../lib/engine/types";
import { currency, fte } from "../../lib/format";

const staffed = (role: RoleDelta) => !role.automated && !role.unassigned;

export function RoleMoveSummary({
  capacity,
  globals,
}: {
  capacity: CapacityBlock;
  globals: Globals;
}) {
  const comparison = compareCapacity(capacity, capacity.baseColumn, capacity.targetColumn, {
    excludeRowIds: new Set(capacity.excludedRowIds),
  });

  const moving = comparison.roles
    .filter(staffed)
    .filter((role) => Math.abs(role.deltaFte) > 0.005 || role.fromFte > 0 || role.toFte > 0)
    .sort((a, b) => Math.abs(b.deltaFte) - Math.abs(a.deltaFte));

  if (moving.length === 0) {
    return (
      <div className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">
        No staffed role has work against it yet. Give each task a current role, a handling time
        and a volume, and the current-against-future comparison appears here.
      </div>
    );
  }

  const anyCost = capacity.roles.some((r) => typeof r.annualCost === "number");
  const costs = effectiveCostInputs(globals);
  const valuation = anyCost
    ? valueCapacity(capacity, {
        severanceWeeks: costs.severanceWeeks,
        includeOneTimeCosts: globals.implementationCosts !== "None",
      })
    : null;

  // Not "are the two columns the same" — with the simple format they never are, they are
  // `current` and `target`. What matters is whether any task actually names a different
  // future role, which is what a zero delta on every role tells you.
  const nothingMoving = moving.every((role) => Math.abs(role.deltaFte) < 0.005);

  return (
    <div className="space-y-4 rounded-2xl bg-canvas p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
          Current against future
        </p>
        <span className="text-xs text-outline">
          Required FTE to carry the same work under each assignment
        </span>
      </div>

      {nothingMoving ? (
        <p className="text-xs text-muted">
          <strong className="text-ink">Nothing is moving yet.</strong> Every task&rsquo;s future
          role is the same as its current one, so the two columns are identical. Set a future
          role on the tasks that change and this table shows what it does.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Current against future by role">
          <thead>
            <tr className="text-left">
              {[
                { label: "Role", align: "" },
                { label: "Current FTE", align: "text-right" },
                { label: "Future FTE", align: "text-right" },
                { label: "Delta", align: "text-right" },
                ...(valuation
                  ? [
                      { label: "Current cost", align: "text-right" },
                      { label: "Future cost", align: "text-right" },
                    ]
                  : []),
              ].map(({ label, align }) => (
                <th
                  key={label}
                  className={`px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${align}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {moving.map((role) => {
              const valued = valuation?.roles.find((r) => r.role === role.role);
              return (
                <tr key={role.role} className="border-t border-slate-200/70">
                  <td className="px-3 py-2 font-semibold text-ink">{role.role}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {fte(role.fromFte, 2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {fte(role.toFte, 2)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Delta value={role.deltaFte} />
                  </td>
                  {valuation ? (
                    <>
                      {/* Each side at this role's own rate. A role with no rate reads n/a
                          rather than zero — the excluded FTE is named under the table. */}
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {valued && !isMissing(valued.annualCost)
                          ? currency(valued.fromFte * valued.annualCost)
                          : "n/a"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {valued && !isMissing(valued.annualCost)
                          ? currency(valued.toFte * valued.annualCost)
                          : "n/a"}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td className="px-3 py-2 font-bold text-ink">Total</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                {fte(comparison.from.requiredFte, 2)}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                {fte(comparison.to.requiredFte, 2)}
              </td>
              <td className="px-3 py-2 text-right">
                <Delta value={comparison.netFteChange} bold />
              </td>
              {valuation ? (
                <>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                    {currency(valuation.annualCostFrom)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                    {currency(valuation.annualCostTo)}
                  </td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {valuation ? (
        <p className="rounded-2xl bg-ink px-4 py-3 text-sm text-white">
          <span className="font-bold">
            {valuation.grossAnnualSaving >= 0 ? "Annual saving" : "Annual increase"}{" "}
            {currency(Math.abs(valuation.grossAnnualSaving))}
          </span>{" "}
          <span className="text-white/70">
            &mdash; {currency(valuation.annualCostFrom)} today against{" "}
            {currency(valuation.annualCostTo)} under the future assignment, on the fractional
            requirement. {valuation.currency}.
            {valuation.rolesWithoutCost.length > 0
              ? ` ${valuation.rolesWithoutCost.join(", ")} carries no cost and is excluded, hiding ${fte(Math.abs(valuation.uncostedFteChange), 2)} FTE of change.`
              : ""}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">No cost against any role yet</span>, so there
          is no money here — only the FTE shift. Enter an all-in annual cost per role in the{" "}
          <strong className="text-ink">Role capacity</strong> step and the current cost, the
          future cost and the delta appear in this table. Nothing is assumed on your behalf:
          there is no defensible industry figure for a role&rsquo;s all-in cost.
        </p>
      )}

      <p className="text-xs text-outline">
        Both columns are what the measured work <em>requires</em>, one under today&rsquo;s
        assignment and one under the future. Neither is actual headcount, so a role that shrinks
        is releasing requirement rather than releasing people.
      </p>
    </div>
  );
}

function Delta({ value, bold = false }: { value: number; bold?: boolean }) {
  if (isMissing(value)) return <span className="text-xs text-outline">n/a</span>;
  const weight = bold ? "font-bold" : "font-semibold";
  if (Math.abs(value) < 0.005) {
    return <span className={`text-xs ${weight} text-outline`}>no change</span>;
  }
  // The sign and the words carry the direction; only the direction that costs money is
  // coloured, so nothing here depends on colour alone.
  const more = value > 0;
  return (
    <span className={`tabular-nums text-sm ${weight} ${more ? "text-red-600" : "text-ink"}`}>
      {more ? "+" : "−"}
      {fte(Math.abs(value), 2)}{" "}
      <span className="text-xs font-semibold">{more ? "needed" : "released"}</span>
    </span>
  );
}
