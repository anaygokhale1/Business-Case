/**
 * Capacity by role.
 *
 * One question, answered for whichever role assignment the caller asks for:
 *
 *   minutesPerTransaction(role, lob, type)
 *     = SUM over statuses of  share(type, status)
 *       x SUM over applicable steps owned by that role of  effectiveMinutes
 *
 *   totalMinutes(role) = SUM over (lob, type) of  submissions x minutesPerTransaction
 *
 *   requiredFTE(role)  = totalMinutes / (hours x utilisation x 60)
 *
 * The status weighting is the load-bearing part. A submission that is lost or declined
 * still consumes most of the work a bound one does, so capacity must be driven by
 * transactions RECEIVED weighted across their outcomes — not by policies written. Using
 * bound volume against bound-only minutes understates the requirement by roughly half.
 *
 * G18 applies as it does everywhere else: the total is the sum of per-row contributions,
 * each divided by its own role's productive minutes. There is deliberately no path that
 * divides an aggregate of minutes by an average of denominators.
 */

import { MISSING, isMissing, round6 } from "./alg";
import {
  applies,
  distinctRoles,
  effectiveMinutes,
  roleFor,
  sharesForCell,
  type CapacityStudy,
  type ProcessRow,
  type RoleCapacity,
} from "./process-study";
import { SENTINEL } from "./types";

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export interface RoleResult {
  role: string;
  /** Expected minutes of work per year across the whole demand. */
  totalMinutes: number;
  /** Productive minutes one FTE of this role supplies per year. */
  minutesPerFte: number;
  /** totalMinutes / minutesPerFte. Fractional on purpose — see `wholeFte`. */
  requiredFte: number;
  /** Rounded up. A role needing 4.2 people needs 5 unless the work can be split. */
  wholeFte: number;
  /** Steps contributing to this role. */
  stepCount: number;
  /** Steps whose owner was carried forward from the current column (G30). */
  carriedStepCount: number;
  automated: boolean;
  unassigned: boolean;
}

export interface CapacityResult {
  /** Which role column this was computed against. */
  column: string;
  roles: RoleResult[];
  /** Minutes of work needing a human. Excludes automated and unassigned roles. */
  staffedMinutes: number;
  /** Minutes assigned to an automation target. */
  automatedMinutes: number;
  /** Minutes whose owner is a placeholder rather than a real team. */
  unassignedMinutes: number;
  /** Every minute in the study, whatever it is assigned to. */
  totalMinutes: number;
  /** Sum of the per-role fractional requirement, staffed roles only. */
  requiredFte: number;
  /** Sum of the per-role rounded requirement. Never below `requiredFte`. */
  wholeFte: number;
  /** Steps with no assignment in any column, so they reach no role at all. */
  orphanedStepCount: number;
  orphanedMinutes: number;
  /** Steps whose minutes could not be computed because an input was missing. */
  incompleteStepCount: number;
}

/* -------------------------------------------------------------------------- */
/* Demand                                                                     */
/* -------------------------------------------------------------------------- */

const submissionsOf = (cell: { submissions: unknown }): number => {
  if (cell.submissions === SENTINEL) return MISSING;
  return typeof cell.submissions === "number" ? cell.submissions : MISSING;
};

/**
 * Productive minutes per FTE per year.
 *
 * Per role, never blended. If a shared-service centre runs a different calendar or a
 * different utilisation from an underwriting team, one average denominator would
 * misstate both — and it is exactly the roles that differ most that the reallocation
 * moves work between.
 */
export const minutesPerFte = (role: RoleCapacity): number => {
  const hours = role.workingHoursPerYear;
  const util = role.utilisationPct;
  if (!(hours > 0) || !(util > 0)) return MISSING;
  return hours * util * 60;
};

/* -------------------------------------------------------------------------- */
/* The computation                                                            */
/* -------------------------------------------------------------------------- */

interface Accumulator {
  minutes: number;
  steps: Set<string>;
  carried: Set<string>;
}

const emptyAcc = (): Accumulator => ({ minutes: 0, steps: new Set(), carried: new Set() });

/**
 * Capacity for one role column.
 *
 * `excludeRowIds` lets the caller drop the surplus copies of a duplicate group after
 * deciding they are data-entry duplicates. Nothing is dropped by default (G28).
 */
export const computeCapacity = (
  study: CapacityStudy,
  column: string,
  options: { excludeRowIds?: ReadonlySet<string>; fallbackColumn?: string } = {},
): CapacityResult => {
  const exclude = options.excludeRowIds ?? new Set<string>();
  const fallbackColumn = options.fallbackColumn ?? "current";

  const paramsByRole = new Map<string, RoleCapacity>();
  for (const role of study.roles) paramsByRole.set(role.role, role);

  const acc = new Map<string, Accumulator>();
  let orphanedMinutes = 0;
  const orphaned = new Set<string>();
  const incomplete = new Set<string>();

  // Rows are indexed by (lob) once, so the inner loops do not rescan the register for
  // every demand cell. With ~2,000 rows and ~10 demand cells the naive form is fine,
  // but this keeps the shape linear if a study arrives an order of magnitude larger.
  const byLob = new Map<string, ProcessRow[]>();
  for (const row of study.rows) {
    if (exclude.has(row.id)) continue;
    byLob.set(row.lob, [...(byLob.get(row.lob) ?? []), row]);
  }

  for (const cell of study.demand) {
    const submissions = submissionsOf(cell);
    const shares = sharesForCell(cell, study.statusShares);
    const statuses = Object.keys(shares);
    const rows = byLob.get(cell.lob) ?? [];

    for (const row of rows) {
      const minutes = effectiveMinutes(row);
      if (isMissing(minutes)) {
        incomplete.add(row.id);
        continue;
      }

      // The share-weighted count of transactions that actually reach this step.
      let weighted = 0;
      for (const status of statuses) {
        if (applies(row, cell.transactionType, status)) weighted += shares[status] ?? 0;
      }
      // A study with no status dimension at all still needs its steps counted.
      if (statuses.length === 0 && applies(row, cell.transactionType, "")) weighted = 1;
      if (weighted === 0) continue;

      const contribution = isMissing(submissions) ? MISSING : submissions * weighted * minutes;

      const assignment = roleFor(row, column, fallbackColumn);
      if (assignment === null) {
        orphaned.add(row.id);
        if (!isMissing(contribution)) orphanedMinutes += contribution;
        continue;
      }

      const bucket = acc.get(assignment.role) ?? emptyAcc();
      bucket.minutes = isMissing(contribution) ? MISSING : bucket.minutes + contribution;
      bucket.steps.add(row.id);
      if (assignment.carried) bucket.carried.add(row.id);
      acc.set(assignment.role, bucket);
    }
  }

  // Every role named anywhere in the study appears in the result, even at zero. A role
  // that has lost all its work must be visible as zero rather than absent, because
  // "0 FTE" and "not in the model" read identically once the row is missing.
  for (const role of distinctRoles(study.rows, study.roleColumns)) {
    if (!acc.has(role)) acc.set(role, emptyAcc());
  }

  const roles: RoleResult[] = [...acc.entries()]
    .map(([role, bucket]) => {
      const params = paramsByRole.get(role);
      const perFte = params ? minutesPerFte(params) : MISSING;
      const automated = params?.automated ?? false;
      const unassigned = params?.unassigned ?? false;
      const required =
        automated || unassigned || isMissing(bucket.minutes) || isMissing(perFte)
          ? MISSING
          : bucket.minutes / perFte;

      return {
        role,
        totalMinutes: bucket.minutes,
        minutesPerFte: perFte,
        requiredFte: required,
        // Rounded through round6 first: the pre-round is what stops a value of
        // 4.000000000000001 becoming 5 whole people.
        wholeFte: isMissing(required) ? MISSING : Math.ceil(round6(required)),
        stepCount: bucket.steps.size,
        carriedStepCount: bucket.carried.size,
        automated,
        unassigned,
      };
    })
    .sort((a, b) => (b.totalMinutes || 0) - (a.totalMinutes || 0));

  const sumBy = (predicate: (r: RoleResult) => boolean, pick: (r: RoleResult) => number) =>
    roles.filter(predicate).reduce((total, r) => {
      const value = pick(r);
      return isMissing(value) ? total : total + value;
    }, 0);

  const staffed = (r: RoleResult) => !r.automated && !r.unassigned;

  return {
    column,
    roles,
    staffedMinutes: sumBy(staffed, (r) => r.totalMinutes),
    automatedMinutes: sumBy((r) => r.automated, (r) => r.totalMinutes),
    unassignedMinutes: sumBy((r) => r.unassigned, (r) => r.totalMinutes),
    totalMinutes: sumBy(() => true, (r) => r.totalMinutes) + orphanedMinutes,
    requiredFte: sumBy(staffed, (r) => r.requiredFte),
    wholeFte: sumBy(staffed, (r) => r.wholeFte),
    orphanedStepCount: orphaned.size,
    orphanedMinutes,
    incompleteStepCount: incomplete.size,
  };
};

/* -------------------------------------------------------------------------- */
/* Comparing two assignments                                                  */
/* -------------------------------------------------------------------------- */

export interface RoleDelta {
  role: string;
  fromMinutes: number;
  toMinutes: number;
  fromFte: number;
  toFte: number;
  /** Positive means this role needs MORE people in the target state. */
  deltaFte: number;
  automated: boolean;
  unassigned: boolean;
}

export interface CapacityComparison {
  from: CapacityResult;
  to: CapacityResult;
  roles: RoleDelta[];
  /** Net change in staffed FTE. Often small even when the role mix moves a lot. */
  netFteChange: number;
  /** FTE leaving roles that shrink. The gross movement, which net hides. */
  fteOut: number;
  /** FTE joining roles that grow. */
  fteIn: number;
  /** Minutes that left human capacity between the two states. */
  automatedMinutesGained: number;
}

/**
 * Compare two role assignments over the same demand.
 *
 * The gross movement is reported alongside the net, because they answer different
 * questions and the net alone is misleading: 40 FTE out of one role and 38 into
 * another is a net of 2 but a transition affecting 78 people.
 */
export const compareCapacity = (
  study: CapacityStudy,
  fromColumn: string,
  toColumn: string,
  options: { excludeRowIds?: ReadonlySet<string> } = {},
): CapacityComparison => {
  const from = computeCapacity(study, fromColumn, options);
  const to = computeCapacity(study, toColumn, options);

  const byRole = new Map<string, { from?: RoleResult; to?: RoleResult }>();
  for (const r of from.roles) byRole.set(r.role, { ...byRole.get(r.role), from: r });
  for (const r of to.roles) byRole.set(r.role, { ...byRole.get(r.role), to: r });

  const zero = (x: number | undefined) => (x === undefined || isMissing(x) ? 0 : x);

  const roles: RoleDelta[] = [...byRole.entries()]
    .map(([role, pair]) => ({
      role,
      fromMinutes: pair.from?.totalMinutes ?? 0,
      toMinutes: pair.to?.totalMinutes ?? 0,
      fromFte: pair.from?.requiredFte ?? MISSING,
      toFte: pair.to?.requiredFte ?? MISSING,
      deltaFte: zero(pair.to?.requiredFte) - zero(pair.from?.requiredFte),
      automated: pair.to?.automated ?? pair.from?.automated ?? false,
      unassigned: pair.to?.unassigned ?? pair.from?.unassigned ?? false,
    }))
    .sort((a, b) => Math.abs(b.deltaFte) - Math.abs(a.deltaFte));

  const staffed = roles.filter((r) => !r.automated && !r.unassigned);

  return {
    from,
    to,
    roles,
    netFteChange: to.requiredFte - from.requiredFte,
    fteOut: staffed.reduce((t, r) => t + (r.deltaFte < 0 ? -r.deltaFte : 0), 0),
    fteIn: staffed.reduce((t, r) => t + (r.deltaFte > 0 ? r.deltaFte : 0), 0),
    automatedMinutesGained: to.automatedMinutes - from.automatedMinutes,
  };
};

/* -------------------------------------------------------------------------- */
/* Per-transaction view                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Minutes per transaction by role, for one (lob, transactionType).
 *
 * This is the figure a client recognises from their own workbook — "underwriting spends
 * 855 minutes on a new bound submission" — so it is worth exposing directly rather than
 * only as an input to the FTE calculation. It is also the number that makes the status
 * weighting visible: bound and declined differ, and both are shown.
 */
export const minutesPerTransaction = (
  study: CapacityStudy,
  column: string,
  lob: string,
  transactionType: string,
  status: string,
  options: { excludeRowIds?: ReadonlySet<string>; fallbackColumn?: string } = {},
): Map<string, number> => {
  const exclude = options.excludeRowIds ?? new Set<string>();
  const fallbackColumn = options.fallbackColumn ?? "current";
  const out = new Map<string, number>();

  for (const row of study.rows) {
    if (exclude.has(row.id)) continue;
    if (row.lob !== lob) continue;
    if (!applies(row, transactionType, status)) continue;

    const minutes = effectiveMinutes(row);
    if (isMissing(minutes)) continue;

    const assignment = roleFor(row, column, fallbackColumn);
    const key = assignment?.role ?? "(unassigned)";
    out.set(key, (out.get(key) ?? 0) + minutes);
  }

  return out;
};
