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
import { savingSources, valueCapacity } from "../../lib/engine/capacity-value";
import type { AnswerStatus } from "../../lib/case-questions";
import type { Case } from "../../lib/engine/types";
import { count, currency, fte, months } from "../../lib/format";
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

  // Roles OR rows is enough. A preset seeds the role grades before any study arrives,
  // precisely so costs and locations can be captured while the study is still being
  // chased — and an empty state here would hide the fields that make that possible.
  if (!capacity || (capacity.rows.length === 0 && capacity.roles.length === 0)) {
    return (
      <Panel title="Role capacity" blurb={blurb}>
        <Note>
          Nothing to configure yet. Upload a process study in the previous step, or pick an
          industry template in the first step, and the roles will appear here.
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
  const { workingCase, dispatch } = useCaseStore();
  const globals = workingCase.globals;
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

  const valuation = useMemo(
    () =>
      hasDemand
        ? valueCapacity(capacity, {
            severanceWeeks: globals.severanceWeeks,
            includeOneTimeCosts: globals.implementationCosts !== "None",
          })
        : null,
    [capacity, hasDemand, globals.severanceWeeks, globals.implementationCosts],
  );

  const sources = useMemo(
    () => (valuation ? savingSources(capacity, valuation) : null),
    [capacity, valuation],
  );

  /**
   * The money block appears only once at least one role has a cost.
   *
   * Rendering it at zero would read as "there is no opportunity here" when it actually
   * means "no cost has been supplied" — the two look identical and only one of them is
   * a finding.
   */
  const anyCost = capacity.roles.some((r) => typeof r.annualCost === "number");

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
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Location
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  All-in cost
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                  Cost change
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {capacity.roles.map((role) => {
                const delta = comparison?.roles.find((r) => r.role === role.role);
                const costRow = valuation?.roles.find((r) => r.role === role.role);
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
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        aria-label={`${role.role} location`}
                        className={`${inputClass} min-w-[7rem]`}
                        value={role.location ?? ""}
                        placeholder={special ? "—" : "Onshore"}
                        disabled={special}
                        onChange={(event) =>
                          dispatch({
                            type: "capacity/setRoleParam",
                            role: role.role,
                            patch: { location: event.target.value },
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <NumberInput
                        ariaLabel={`${role.role} all-in annual cost`}
                        value={typeof role.annualCost === "number" ? role.annualCost : null}
                        onChange={(v) =>
                          dispatch({
                            type: "capacity/setRoleParam",
                            role: role.role,
                            // Cleared means unknown, never free — a zero cost would make the
                            // role look like a costless place to move work to.
                            patch: { annualCost: v === null ? "n/a" : v },
                          })
                        }
                        dp={0}
                        placeholder={special ? "—" : "—"}
                      />
                    </td>
                    <td
                      className={
                        !costRow || isMissing(costRow.deltaCost)
                          ? "px-4 py-3 text-right tabular-nums text-outline"
                          : costRow.deltaCost < 0
                            ? "px-4 py-3 text-right font-bold tabular-nums text-teal"
                            : "px-4 py-3 text-right font-bold tabular-nums text-ink"
                      }
                    >
                      {!costRow || isMissing(costRow.deltaCost)
                        ? "—"
                        : currency(costRow.deltaCost)}
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

        {valuation && !anyCost ? (
          <Note>
            Capacity is computed, but no role has an all-in annual cost yet, so there is nothing
            to value. Neither uploaded file carries a cost figure — enter one per role above and
            the annual saving appears here. Costs are captured per role <em>and</em> location,
            because in a right-shift most of the saving comes from work moving somewhere cheaper
            rather than to a cheaper grade in the same place.
          </Note>
        ) : null}

        {/* ---------------- the money ---------------- */}
        {valuation && anyCost ? (
          <div className="space-y-5 rounded-[28px] bg-ink p-6 text-white">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  Annual saving &middot; {valuation.baseColumn} &rarr; {valuation.targetColumn}
                </p>
                <p className="mt-1 text-3xl font-extrabold tabular-nums">
                  {currency(valuation.grossAnnualSaving)}{" "}
                  <span className="text-base font-bold text-white/60">{valuation.currency}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  On whole FTE
                </p>
                <p className="mt-1 text-xl font-extrabold tabular-nums text-white/80">
                  {currency(valuation.grossAnnualSavingWhole)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <Bridge label={`Cost today (${valuation.baseColumn})`} value={currency(valuation.annualCostFrom)} />
              <Bridge label={`Cost target (${valuation.targetColumn})`} value={currency(valuation.annualCostTo)} />
              <Bridge
                label="One-time cost"
                value={currency(valuation.oneTimeCost)}
                sub={
                  valuation.oneTimeCost > 0
                    ? `${fte(valuation.exitingFte)} exiting, ${fte(valuation.unfilledFte)} to recruit`
                    : "not modelled"
                }
              />
            </div>

            {sources && Math.abs(valuation.grossAnnualSaving) > 1 ? (
              <div className="grid gap-4 border-t border-white/15 pt-4 text-sm sm:grid-cols-4">
                <Bridge label="From a cheaper grade" value={currency(sources.gradeShift)} />
                <Bridge label="From a cheaper location" value={currency(sources.locationShift)} />
                <Bridge label="From automation" value={currency(sources.automation)} />
                <Bridge label="Unattributed" value={currency(sources.unattributed)} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-5 border-t border-white/15 pt-4">
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  Redeployment rate
                </span>
                <NumberInput
                  ariaLabel="Redeployment rate"
                  className="w-28 rounded-2xl border border-white/25 bg-white/10 px-4 py-2.5 text-right text-sm tabular-nums text-white outline-none focus:border-white/60"
                  value={capacity.redeploymentRate}
                  onChange={(v) =>
                    dispatch({
                      type: "capacity/setNumber",
                      field: "redeploymentRate",
                      value: v ?? 0,
                    })
                  }
                  scale={100}
                  suffix="%"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  Recruitment cost
                </span>
                <NumberInput
                  ariaLabel="Recruitment cost percent"
                  className="w-28 rounded-2xl border border-white/25 bg-white/10 px-4 py-2.5 text-right text-sm tabular-nums text-white outline-none focus:border-white/60"
                  value={capacity.recruitmentCostPct}
                  onChange={(v) =>
                    dispatch({
                      type: "capacity/setNumber",
                      field: "recruitmentCostPct",
                      value: v ?? 0,
                    })
                  }
                  scale={100}
                  suffix="%"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  Currency
                </span>
                <input
                  type="text"
                  aria-label="Currency"
                  className="w-24 rounded-2xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm text-white outline-none focus:border-white/60"
                  value={capacity.currency}
                  onChange={(event) =>
                    dispatch({ type: "capacity/setCurrency", currency: event.target.value })
                  }
                />
              </label>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">
                  Payback
                </p>
                <p className="mt-1 text-lg font-extrabold tabular-nums">
                  {months(valuation.paybackMonths)}
                </p>
              </div>
            </div>

            {valuation.rolesWithoutCost.length > 0 ? (
              <p className="rounded-2xl bg-white/10 px-4 py-3 text-xs text-white/80">
                <strong>{valuation.rolesWithoutCost.join(", ")}</strong> have an FTE change of{" "}
                {fte(valuation.uncostedFteChange)} but no cost, so they are excluded from every
                figure above. A missing cost is not treated as zero — that would read as a role
                that is free, which is the direction that flatters the case.
              </p>
            ) : null}
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

function Bridge({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/60">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-white/60">{sub}</p> : null}
    </div>
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
