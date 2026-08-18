/**
 * Driver resolution — the one place that decides what a unit's effective value
 * for a driver actually is, and where it came from.
 *
 * There are three states, and none of them is 0:
 *   number       -> the unit supplies its own value      (origin 'own')
 *   key absent   -> inherit the global assumption        (origin 'inherited')
 *   SENTINEL     -> known-missing, must not become 0     (origin 'missing')
 *
 * One resolver serves three consumers, so they cannot disagree: the own/inherited
 * badge in the register, `LitSpec.origin` in the trace, and the ingest match
 * report ("handle time: 9 of 14 units supplied, 5 inherit global 20.0 min").
 */

import { MISSING } from "./alg";
import type {
  Case,
  Driver,
  Globals,
  Origin,
  Resolved,
  Role,
  TimeStudyRow,
  Unit,
} from "./types";
import { SENTINEL } from "./types";

/** Drivers a unit may override. Anything else is global-only. */
export type InheritableDriver =
  | "handleTimeMinutes"
  | "workingHoursPerYear"
  | "utilisationPct"
  | "upliftPct";

export const INHERITABLE_DRIVERS: readonly InheritableDriver[] = [
  "handleTimeMinutes",
  "workingHoursPerYear",
  "utilisationPct",
  "upliftPct",
] as const;

const resolveValue = (raw: Driver | undefined, fallback: number): Resolved => {
  if (raw === SENTINEL) return { value: MISSING, origin: "missing" };
  if (typeof raw === "number") return { value: raw, origin: "own" };
  return { value: fallback, origin: "inherited" };
};

/**
 * G11 — the volume-weighted average from the Time Study tab.
 *
 * Returns the sentinel rather than 0 when there is no volume, so an empty study
 * cannot silently zero the model's handle time. Callers fall back to the manual
 * value.
 */
export const weightedAverageHandleTime = (rows: TimeStudyRow[]): number => {
  const totalVolume = rows.reduce((acc, r) => acc + r.volume, 0);
  if (totalVolume === 0) return MISSING;
  const weighted = rows.reduce((acc, r) => acc + r.minutes * r.volume, 0);
  return weighted / totalVolume;
};

export interface RoleIndex {
  frontLine: string[];
  managers: string[];
  other: string[];
  all: string[];
}

export const indexRoles = (roles: Role[]): RoleIndex => ({
  frontLine: roles.filter((r) => r.tier === "front-line").map((r) => r.id),
  managers: roles.filter((r) => r.tier === "manager").map((r) => r.id),
  other: roles.filter((r) => r.tier === "other").map((r) => r.id),
  all: roles.map((r) => r.id),
});

export interface ResolvedGlobals extends Globals {
  /**
   * G11 — the active handle time after the Manual / Time Study toggle is applied.
   * Resolved exactly once here; nothing downstream re-reads the toggle.
   */
  activeHandleTimeMinutes: number;
  activeHandleTimeOrigin: Origin;
}

export const resolveGlobals = (c: Case): ResolvedGlobals => {
  const { globals, timeStudy } = c;

  if (globals.handleTimeSource === "Time Study") {
    const weighted = weightedAverageHandleTime(timeStudy);
    // An empty study falls back to the manual entry rather than to the sentinel:
    // the toggle should not be able to break a model that has a manual value.
    const usable = Number.isNaN(weighted) ? globals.handleTimeMinutes : weighted;
    return {
      ...globals,
      activeHandleTimeMinutes: usable,
      activeHandleTimeOrigin: Number.isNaN(weighted) ? "default" : "input",
    };
  }

  return {
    ...globals,
    activeHandleTimeMinutes: globals.handleTimeMinutes,
    activeHandleTimeOrigin: "input",
  };
};

/**
 * Evaluation context for a single unit.
 *
 * G23 — note what is NOT here: the unit array. A per-unit computation takes this
 * context and one unit, so it structurally cannot read a sibling row. That is the
 * bug class the AIG workbook shipped, where four register columns were joined to
 * an arbitrary other building because relative row references survived a sort.
 */
export interface Ctx {
  globals: ResolvedGlobals;
  roles: RoleIndex;
}

export const buildCtx = (c: Case): Ctx => ({
  globals: resolveGlobals(c),
  roles: indexRoles(c.roles),
});

/** The global fallback for each inheritable driver. */
const globalFallback = (g: ResolvedGlobals, key: InheritableDriver): number => {
  switch (key) {
    case "handleTimeMinutes":
      return g.activeHandleTimeMinutes;
    case "workingHoursPerYear":
      return g.workingHoursPerYear;
    case "utilisationPct":
      return g.utilisationPct;
    case "upliftPct":
      return g.upliftPct;
  }
};

export const resolveDriver = (
  unit: Unit,
  ctx: Ctx,
  key: InheritableDriver,
): Resolved => resolveValue(unit[key], globalFallback(ctx.globals, key));

/** Volume is required, so it has no global fallback — absent means missing. */
export const resolveVolume = (unit: Unit): Resolved => {
  if (unit.volume === SENTINEL) return { value: MISSING, origin: "missing" };
  if (typeof unit.volume === "number") return { value: unit.volume, origin: "own" };
  return { value: MISSING, origin: "missing" };
};

/** Sum a per-role map over a set of role ids, propagating the sentinel. */
export const sumRoles = (
  map: Record<string, Driver>,
  roleIds: readonly string[],
): number => {
  let acc = 0;
  for (const id of roleIds) {
    const raw = map[id];
    if (raw === SENTINEL) return MISSING;
    if (typeof raw === "number") acc += raw;
  }
  return acc;
};

/**
 * Coverage read-out for the ingest match report and the register badges: how many
 * units supplied each inheritable driver themselves.
 */
export interface DriverCoverage {
  driver: InheritableDriver;
  own: number;
  inherited: number;
  missing: number;
  total: number;
}

export const driverCoverage = (c: Case): DriverCoverage[] =>
  INHERITABLE_DRIVERS.map((driver) => {
    let own = 0;
    let missing = 0;
    for (const unit of c.units) {
      const raw = unit[driver];
      if (raw === SENTINEL) missing += 1;
      else if (typeof raw === "number") own += 1;
    }
    return {
      driver,
      own,
      missing,
      inherited: c.units.length - own - missing,
      total: c.units.length,
    };
  });
