"use client";

/**
 * Working hours and utilisation per role, and the resulting capacity.
 *
 * Neither figure is in either uploaded file, so every role starts on the documented
 * default and is badged as one. Showing required FTE in the same view is deliberate: it
 * is the only way to see that a utilisation change of five points moves the answer by a
 * person, which is the thing a reviewer needs to feel before signing the assumption off.
 */

import { useMemo } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { isMissing } from "../../lib/engine/alg";
import { compareCapacity, computeCapacity, minutesPerFte } from "../../lib/engine/capacity";
import { checkCapacityStudy } from "../../lib/engine/capacity-qc";
import type { AnswerStatus } from "../../lib/case-questions";
import type { Case } from "../../lib/engine/types";
import { count, fte } from "../../lib/format";
import { ghostButtonClass, inputClass, Note, NumberInput, Panel } from "./fields";

/**
 * Split in two on purpose.
 *
 * The empty state has to return before any hook runs, and a hook called after an early
 * return changes the hook order the moment a study is uploaded — which React treats as a
 * different component and throws on. So the guard lives out here and every hook lives in
 * `Loaded`, which only ever renders with a study present.
 */
export function BatchRoleCapacity({
  status,
  blurb,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
}) {
  const { workingCase } = useCaseStore();
  const capacity = workingCase.capacity;

  if (!capacity || capacity.rows.length === 0) {
    return (
      <Panel title="Role capacity" blurb={blurb}>
        <Note>
          Nothing to configure yet. Upload a process study in the previous step and the roles
          it names will appear here.
        </Note>
      </Panel>
    );
  }

  return <Loaded status={status} blurb={blurb} capacity={capacity} />;
}

function Loaded({
  status,
  blurb,
  capacity,
}: {
  status: Record<string, AnswerStatus>;
  blurb: string;
  capacity: NonNullable<Case["capacity"]>;
}) {
  const { dispatch } = useCaseStore();
  const hasDemand = capacity.demand.length > 0;

  // One recompute for the whole panel. The engine is fast enough that this is cheaper
  // than threading memoised slices through every row.
  const comparison = useMemo(
    () =>
      hasDemand
        ? compareCapacity(capacity, capacity.baseColumn, capacity.targetColumn, {
            excludeRowIds: new Set(capacity.excludedRowIds),
          })
        : null,
    [capacity, hasDemand],
  );

  const base = useMemo(
    () =>
      computeCapacity(capacity, capacity.baseColumn, {
        excludeRowIds: new Set(capacity.excludedRowIds),
      }),
    [capacity],
  );

  const violations = useMemo(
    () =>
      checkCapacityStudy(capacity, {
        fromColumn: capacity.baseColumn,
        toColumn: capacity.targetColumn,
        excludeRowIds: new Set(capacity.excludedRowIds),
      }),
    [capacity],
  );

  const errors = violations.filter((v) => v.severity === "error");
  const warnings = violations.filter((v) => v.severity === "warn");

  return (
    <Panel
      title="Role capacity"
      blurb={blurb}
      aside={
        hasDemand ? (
          <div className="rounded-2xl bg-canvas px-4 py-3 text-right">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Required FTE, as-is
            </p>
            <p className="text-xl font-extrabold tabular-nums text-ink">{fte(base.requiredFte)}</p>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Role
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Hours / yr <span className="text-slate-300">C3</span>
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Utilisation
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Productive min
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  FTE as-is
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  FTE to-be
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Change
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {capacity.roles.map((role) => {
                const delta = comparison?.roles.find((r) => r.role === role.role);
                const perFte = minutesPerFte(role);
                const special = role.automated || role.unassigned;

                return (
                  <tr key={role.role} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{role.role}</span>
                      {role.automated ? (
                        <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-outline">
                          automated
                        </span>
                      ) : null}
                      {role.unassigned ? (
                        <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-outline">
                          no owner
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <NumberInput
                        ariaLabel={`${role.role} working hours per year`}
                        value={role.workingHoursPerYear > 0 ? role.workingHoursPerYear : null}
                        onChange={(v) =>
                          dispatch({
                            type: "capacity/setRoleParam",
                            role: role.role,
                            patch: { workingHoursPerYear: v ?? 0 },
                          })
                        }
                        dp={0}
                        placeholder={special ? "—" : "1880"}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <NumberInput
                        ariaLabel={`${role.role} utilisation percent`}
                        value={role.utilisationPct > 0 ? role.utilisationPct : null}
                        onChange={(v) =>
                          dispatch({
                            type: "capacity/setRoleParam",
                            role: role.role,
                            patch: { utilisationPct: v ?? 0 },
                          })
                        }
                        scale={100}
                        suffix="%"
                        placeholder={special ? "—" : "75"}
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">
                      {isMissing(perFte) ? "—" : count(perFte)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {delta && !isMissing(delta.fromFte) ? fte(delta.fromFte) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {delta && !isMissing(delta.toFte) ? fte(delta.toFte) : "—"}
                    </td>
                    <td
                      className={
                        !delta || special
                          ? "px-4 py-3 text-right tabular-nums text-outline"
                          : delta.deltaFte > 0.05
                            ? "px-4 py-3 text-right font-bold tabular-nums text-ink"
                            : delta.deltaFte < -0.05
                              ? "px-4 py-3 text-right font-bold tabular-nums text-teal"
                              : "px-4 py-3 text-right tabular-nums text-outline"
                      }
                    >
                      {!delta || special
                        ? "—"
                        : `${delta.deltaFte > 0 ? "+" : ""}${fte(delta.deltaFte)}`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <select
                        aria-label={`${role.role} kind`}
                        className={`${inputClass} min-w-[9rem]`}
                        value={role.automated ? "automated" : role.unassigned ? "unassigned" : "staffed"}
                        onChange={(event) => {
                          const kind = event.target.value;
                          dispatch({
                            type: "capacity/setRoleParam",
                            role: role.role,
                            patch: {
                              automated: kind === "automated",
                              unassigned: kind === "unassigned",
                              ...(kind === "staffed" && role.workingHoursPerYear === 0
                                ? { workingHoursPerYear: 1880, utilisationPct: 0.75 }
                                : {}),
                            },
                          });
                        }}
                      >
                        <option value="staffed">Staffed by people</option>
                        <option value="automated">A system does it</option>
                        <option value="unassigned">Placeholder, no owner</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {comparison ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                    Staffed total
                  </td>
                  <td colSpan={3} />
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {fte(comparison.from.requiredFte)}
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {fte(comparison.to.requiredFte)}
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-ink">
                    {`${comparison.netFteChange > 0 ? "+" : ""}${fte(comparison.netFteChange)}`}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        {!hasDemand ? (
          <Note>
            No volumes yet, so this shows minutes per transaction but no FTE. Upload a volume
            sheet in the previous step and every figure here fills in.
          </Note>
        ) : null}

        {comparison ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Moving out of shrinking roles" value={`${fte(comparison.fteOut)} FTE`} />
            <Stat label="Moving into growing roles" value={`${fte(comparison.fteIn)} FTE`} />
            <Stat
              label="Net change"
              value={`${comparison.netFteChange > 0 ? "+" : ""}${fte(comparison.netFteChange)} FTE`}
            />
          </div>
        ) : null}

        {comparison && comparison.fteOut + comparison.fteIn > Math.abs(comparison.netFteChange) * 1.2 ? (
          <Note>
            The gross movement is larger than the net. {fte(comparison.fteOut)} FTE of work leaves
            one set of roles and {fte(comparison.fteIn)} arrives in another, for a net change of{" "}
            {fte(Math.abs(comparison.netFteChange))}. The net is the cost story; the gross is the
            number of people whose job changes, and it is the one that decides whether this is
            deliverable.
          </Note>
        ) : null}

        {violations.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
              Study checks &middot; {errors.length} blocking, {warnings.length} advisory
            </p>
            <ul className="space-y-2">
              {[...errors, ...warnings].slice(0, 8).map((v, i) => (
                <li key={`${v.id}-${i}`} className="flex gap-3 rounded-2xl bg-canvas px-4 py-3 text-sm">
                  <span
                    className={
                      v.severity === "error"
                        ? "shrink-0 font-extrabold text-red-600"
                        : "shrink-0 font-extrabold text-outline"
                    }
                  >
                    {v.id}
                  </span>
                  <span className="text-muted">{v.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {capacity.excludedRowIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas px-4 py-3">
            <p className="text-xs text-muted">
              {capacity.excludedRowIds.length} duplicate row(s) excluded from the calculation.
            </p>
            <button
              type="button"
              className={ghostButtonClass}
              onClick={() => dispatch({ type: "capacity/setExcludedRowIds", rowIds: [] })}
            >
              Count them all again
            </button>
          </div>
        ) : null}

        <Note>
          Required FTE for a role is its share of the work divided by{" "}
          <strong>that role&rsquo;s own</strong> productive minutes — hours &times; utilisation
          &times; 60. Never one blended denominator: a shared-service centre on a different
          calendar and a different utilisation from an underwriting team would be misstated by
          an average, and those are exactly the roles a reallocation moves work between.
          {status["C3"] === "default"
            ? " Every role is still holding the documented default of 1,880 hours at 75%, which will be labelled as a default on the case."
            : ""}
        </Note>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-canvas p-4">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-ink">{value}</p>
    </div>
  );
}
