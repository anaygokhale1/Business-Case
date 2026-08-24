/**
 * Invariants for the process study, G26 to G30.
 *
 * Every one of these was a live defect in the study this model was built from, and
 * every one of them was silent — the numbers stayed plausible while being wrong. That is
 * the test for whether a rule belongs here: not "could this be wrong" but "would anyone
 * notice".
 */

import { isMissing } from "./alg";
import { compareCapacity, computeCapacity } from "./capacity";
import {
  duplicateGroups,
  effectiveMinutes,
  normaliseRole,
  roleCollisions,
  statedDivergences,
  type CapacityStudy,
} from "./process-study";
import type { Severity, Violation } from "./qc";

const MINUTE_TOLERANCE = 1e-6;

export const checkCapacityStudy = (
  study: CapacityStudy,
  options: { fromColumn?: string; toColumn?: string; excludeRowIds?: ReadonlySet<string> } = {},
): Violation[] => {
  const v: Violation[] = [];
  const fromColumn = options.fromColumn ?? "current";
  const toColumn = options.toColumn ?? study.roleColumns.find((c) => c !== fromColumn) ?? fromColumn;

  /* ---------------------------------------------------------------------- */
  /* G29 — status shares must sum to 100%                                   */
  /* ---------------------------------------------------------------------- */

  for (const [transactionType, shares] of Object.entries(study.statusShares)) {
    const total = Object.values(shares).reduce((a, b) => a + b, 0);
    if (Object.keys(shares).length === 0) continue;
    if (Math.abs(total - 1) > 1e-9) {
      v.push({
        id: "G29",
        // Not normalised silently. The share of submissions that bind is a real
        // assumption a reader will challenge, and rescaling it behind their back
        // means the number they challenge is not the number that was used.
        severity: "error",
        message: `${transactionType} outcome shares sum to ${(total * 100).toFixed(1)}%, not 100%. Required capacity scales directly with these, so every FTE figure is wrong until they add up.`,
        path: `statusShares.${transactionType}`,
        expected: 1,
        actual: total,
      });
    }
    for (const [status, share] of Object.entries(shares)) {
      if (share < 0 || share > 1) {
        v.push({
          id: "G29",
          severity: "error",
          message: `${transactionType} / ${status} share is ${(share * 100).toFixed(1)}%, which is not a share.`,
          path: `statusShares.${transactionType}.${status}`,
          actual: share,
        });
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* G27 — role spellings that differ only in whitespace or case            */
  /* ---------------------------------------------------------------------- */

  for (const collision of roleCollisions(study.rows, study.roleColumns)) {
    v.push({
      id: "G27",
      // A warning, not an error: the engine compares normalised keys so the model is
      // already correct. It is the SOURCE file that is wrong, and it will keep being
      // wrong — and keep breaking the client's own SUMIFS totals — until told.
      severity: "warn",
      message: `Role "${collision.spellings[0]}" is spelled ${collision.spellings.length} different ways in the study: ${collision.spellings.map((s) => JSON.stringify(s)).join(", ")}. Matched as one role here, but a spreadsheet matching on the exact string will silently drop the odd ones out of its totals.`,
      path: "rows.roles",
      actual: collision.spellings.join(" | "),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G28 — identical rows                                                   */
  /* ---------------------------------------------------------------------- */

  const duplicates = duplicateGroups(study.rows, study.roleColumns);
  if (duplicates.length > 0) {
    const excess = duplicates.reduce(
      (total, g) => (isMissing(g.excessMinutes) ? total : total + g.excessMinutes),
      0,
    );
    v.push({
      id: "G28",
      // A judgement, not an error: a step can genuinely happen twice. Nothing in the
      // data distinguishes that from a copy-paste, so it must be decided rather than
      // assumed either way.
      severity: "warn",
      message: `${duplicates.length} group(s) of process rows are identical in every field that affects the calculation, counting ${excess.toFixed(1)} minutes per transaction more than once${duplicates[0] ? ` — largest is "${duplicates[0].label}"` : ""}. Either a step that genuinely repeats, or a duplicated row. Decide per group; nothing is removed automatically.`,
      path: "rows",
      actual: duplicates.length,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G30 — work with no owner                                               */
  /* ---------------------------------------------------------------------- */

  const target = computeCapacity(study, toColumn, {
    ...(options.excludeRowIds ? { excludeRowIds: options.excludeRowIds } : {}),
  });

  if (target.orphanedStepCount > 0) {
    v.push({
      id: "G30",
      severity: "warn",
      message: `${target.orphanedStepCount} process step(s) have no owner in any column, carrying ${target.orphanedMinutes.toFixed(1)} minutes that reach no role at all. They are excluded from every capacity figure, so the totals cover less work than the study describes.`,
      path: "rows.roles",
      actual: target.orphanedStepCount,
    });
  }

  const carried = target.roles.reduce((total, r) => total + r.carriedStepCount, 0);
  if (carried > 0) {
    v.push({
      id: "G30",
      severity: "warn",
      message: `${carried} step(s) have no "${toColumn}" owner and are carried at their current owner. Undecided scope, not eliminated work — a to-be state that dropped them would report an improvement nobody has agreed to.`,
      path: "rows.roles",
      actual: carried,
    });
  }

  if (target.unassignedMinutes > 0) {
    v.push({
      id: "G30",
      severity: "warn",
      message: `${target.unassignedMinutes.toFixed(1)} minutes are assigned to a placeholder owner rather than a real team. Counted as undecided scope and never staffed, because assuming someone does the work is the more dangerous error.`,
      path: "roles",
      actual: target.unassignedMinutes,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G26 — reallocation is time-neutral unless automation is explicit        */
  /* ---------------------------------------------------------------------- */

  if (toColumn !== fromColumn) {
    const comparison = compareCapacity(study, fromColumn, toColumn, {
      ...(options.excludeRowIds ? { excludeRowIds: options.excludeRowIds } : {}),
    });

    // Moving a step between roles cannot change how long it takes. So total minutes
    // must be conserved, except for what moved to an automation target. This is the
    // check the source workbook performs by hand as "Does Current Time = Future Time",
    // and which its own trailing-space bug was quietly failing.
    const accountedFor =
      comparison.to.staffedMinutes +
      comparison.to.unassignedMinutes +
      comparison.to.automatedMinutes;
    const before =
      comparison.from.staffedMinutes +
      comparison.from.unassignedMinutes +
      comparison.from.automatedMinutes;

    const gap = before - accountedFor;
    if (Math.abs(gap) > MINUTE_TOLERANCE * Math.max(1, before)) {
      v.push({
        id: "G26",
        severity: "error" as Severity,
        message: `Reassigning work changed the total from ${before.toFixed(1)} to ${accountedFor.toFixed(1)} minutes, a gap of ${gap.toFixed(1)}. Moving a step between roles cannot change how long it takes, so minutes have been lost — usually a role name that does not match, or a step dropped from the to-be state.`,
        expected: before,
        actual: accountedFor,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* G32 — the study's stated minutes vs its own inputs                      */
  /* ---------------------------------------------------------------------- */

  const divergences = statedDivergences(study.rows);
  if (divergences.length > 0) {
    const net = divergences.reduce((total, d) => total + d.delta, 0);
    const suppressed = divergences.filter((d) => d.delta < 0);
    v.push({
      id: "G32",
      // A warning, because an override is often deliberate — a step taken out of scope
      // without deleting its measurements. But it must be visible: the stated figure is
      // what the totals use, so a value typed over a formula silently changes the answer
      // and leaves the inputs looking as though they still explain it.
      severity: "warn",
      message: `${divergences.length} step(s) state an expected-minutes figure that disagrees with their own handle time and frequency, a net ${net >= 0 ? "+" : ""}${net.toFixed(2)} minutes per transaction${suppressed.length > 0 ? ` (${suppressed.length} suppressing minutes the inputs imply, largest "${divergences[0]!.label}" at ${divergences[0]!.stated} against ${divergences[0]!.computed.toFixed(2)})` : ""}. The stated figure is used, since that is what the source totals use — but check each one is intended.`,
      path: "rows.statedMinutes",
      actual: divergences.length,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Coverage and completeness                                              */
  /* ---------------------------------------------------------------------- */

  if (target.incompleteStepCount > 0) {
    v.push({
      id: "G21",
      severity: "warn",
      message: `${target.incompleteStepCount} step(s) have a missing handle time or frequency and contribute no minutes. Every capacity figure therefore covers ${study.rows.length - target.incompleteStepCount} of ${study.rows.length} steps.`,
      path: "rows",
      actual: target.incompleteStepCount,
    });
  }

  const missingParams = new Set<string>();
  for (const result of target.roles) {
    if (result.totalMinutes > 0 && isMissing(result.minutesPerFte) && !result.automated && !result.unassigned) {
      missingParams.add(result.role);
    }
  }
  if (missingParams.size > 0) {
    v.push({
      id: "G21",
      // Error: a role with work but no productive-hours basis yields no FTE at all,
      // and the portfolio total would then quietly exclude that role's people.
      severity: "error",
      message: `No working hours or utilisation for ${[...missingParams].join(", ")}. These roles carry work but produce no FTE, so the total understates the requirement.`,
      path: "roles",
      actual: [...missingParams].join(", "),
    });
  }

  const demandTotal = study.demand.reduce(
    (total, cell) => (typeof cell.submissions === "number" ? total + cell.submissions : total),
    0,
  );
  if (demandTotal === 0) {
    v.push({
      id: "G21",
      severity: "warn",
      message:
        "No transaction volumes yet, so the study yields minutes per transaction but no FTE. Capacity needs volumes at the same grain as the study.",
      path: "demand",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Frequency sanity                                                       */
  /* ---------------------------------------------------------------------- */

  const overOne = study.rows.filter(
    (r) => typeof r.frequency === "number" && r.frequency > 1,
  );
  if (overOne.length > 0) {
    v.push({
      id: "G31",
      severity: "warn",
      message: `${overOne.length} step(s) have a frequency above 1, so they are modelled as happening more than once per transaction. Legal and sometimes correct — but if the column was meant to be the share of transactions where the step occurs, these are overstated.`,
      path: "rows.frequency",
      actual: overOne.length,
    });
  }

  const zeroFrequency = study.rows.filter(
    (r) => typeof r.frequency === "number" && r.frequency === 0,
  ).length;
  const zeroAht = study.rows.filter(
    (r) => typeof r.ahtMinutes === "number" && r.ahtMinutes === 0 && r.frequency !== 0,
  ).length;
  if (zeroAht > 0) {
    v.push({
      id: "G31",
      severity: "warn",
      message: `${zeroAht} step(s) occur but have a handle time of exactly 0. A step that happens takes some time, so this is more likely an unmeasured step than a free one${zeroFrequency > 0 ? `, distinct from the ${zeroFrequency} step(s) that correctly record a zero frequency because they do not occur` : ""}.`,
      path: "rows.ahtMinutes",
      actual: zeroAht,
    });
  }

  return v;
};

/** Total expected minutes per transaction across a set of rows, for reconciliation. */
export const studyMinutes = (study: CapacityStudy): number =>
  study.rows.reduce((total, row) => {
    const minutes = effectiveMinutes(row);
    return isMissing(minutes) ? total : total + minutes;
  }, 0);

/** Roles named in the study but missing capacity parameters. */
export const rolesWithoutParams = (study: CapacityStudy): string[] => {
  const known = new Set(study.roles.map((r) => normaliseRole(r.role)));
  const out: string[] = [];
  for (const row of study.rows) {
    for (const column of study.roleColumns) {
      const raw = row.roles[column];
      if (raw === undefined || raw.trim() === "") continue;
      const role = normaliseRole(raw);
      if (!known.has(role) && !out.includes(role)) out.push(role);
    }
  }
  return out;
};
