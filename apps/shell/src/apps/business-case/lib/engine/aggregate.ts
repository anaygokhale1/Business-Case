/**
 * Portfolio rollups.
 *
 * G18 — every total here is a SUM of per-unit results. Nothing in this file
 * recomputes a portfolio figure from aggregated inputs, because aggregating the
 * inputs of a nonlinear function (division, CEILING, any threshold) gives a
 * different answer. `identity.ts` divides by each unit's own effective hours;
 * this file only adds those quotients up.
 *
 * G4 — blended cost is SUMPRODUCT(fte, cost) / SUM(fte) across every unit and
 * role. It is never `total savings / headcount reduced`, which is a different
 * number and materially wrong for severance.
 */

import type { AggSpec, Alg } from "./alg";
import { FastAlg, MISSING, isMissing } from "./alg";
import type { Ctx } from "./drivers";
import { sumRoles } from "./drivers";
import type { Case, Unit, UnitResult } from "./types";
import { SENTINEL } from "./types";

/* -------------------------------------------------------------------------- */
/* Blended cost (G4)                                                          */
/* -------------------------------------------------------------------------- */

export interface BlendedInputs<T> {
  fte: T[];
  cost: T[];
  fteSpec: AggSpec;
  sumprodSpec: AggSpec;
}

/**
 * The true weighted-average all-in cost per FTE.
 *
 * Written once against `Alg`, so the app value, the drill-down explanation and the
 * workbook formula are three renderings of this one expression.
 */
export const blendedCost = <T>(A: Alg<T>, i: BlendedInputs<T>): T =>
  A.named(
    "blendedAllIn",
    "Blended all-in cost per FTE",
    "usd",
    A.div(A.sumprod(i.sumprodSpec, i.fte, i.cost), A.sum(i.fteSpec, i.fte)),
  );

/**
 * Flattens every (unit, role) pair into parallel FTE and cost vectors.
 *
 * Pairs where either side is a sentinel are dropped from BOTH vectors together.
 * Dropping only the cost would leave the FTE in the denominator and pull the
 * blended figure down — which is exactly the silent-zero failure G21 exists to
 * prevent, and exactly what Excel does to a text cell inside SUMPRODUCT.
 */
export const flattenCostVectors = (
  units: Unit[],
  roleIds: readonly string[],
): { fte: number[]; cost: number[]; dropped: number } => {
  const fte: number[] = [];
  const cost: number[] = [];
  let dropped = 0;

  for (const unit of units) {
    for (const roleId of roleIds) {
      const f = unit.headcount[roleId];
      const c = unit.cost[roleId];
      if (f === undefined || c === undefined) continue;
      if (f === SENTINEL || c === SENTINEL) {
        dropped += 1;
        continue;
      }
      if (f === 0) continue;
      fte.push(f);
      cost.push(c);
    }
  }
  return { fte, cost, dropped };
};

export interface BlendedResult {
  value: number;
  /** (unit, role) pairs excluded because a side was missing. Surfaced, never hidden. */
  dropped: number;
  pairs: number;
}

export const computeBlendedCost = (
  c: Case,
  roleIds: readonly string[],
  excelRanges?: { sumprod: string; sum: string },
): BlendedResult => {
  const { fte, cost, dropped } = flattenCostVectors(c.units, roleIds);
  if (fte.length === 0) return { value: MISSING, dropped, pairs: 0 };

  const value = blendedCost(FastAlg, {
    fte,
    cost,
    sumprodSpec: {
      label: "SUMPRODUCT(FTE, cost)",
      ...(excelRanges ? { excel: excelRanges.sumprod } : {}),
    },
    fteSpec: { label: "SUM(FTE)", ...(excelRanges ? { excel: excelRanges.sum } : {}) },
  });

  return { value, dropped, pairs: fte.length };
};

/* -------------------------------------------------------------------------- */
/* Portfolio totals — sums of rows, never recomputations                      */
/* -------------------------------------------------------------------------- */

export interface PortfolioTotals {
  units: number;
  currentFrontLine: number;
  currentManagers: number;
  requiredFrontLine: number;
  surplus: number;
  volume: number;
  /**
   * Sensitivity Grid 1's demand factor: total required front-line FTE at the
   * active handle time.
   *
   * The register makes handle time per-unit overridable, which breaks the skill's
   * trick of factoring a single global handle time out of the sum. So the grid's
   * handle-time axis is a MULTIPLIER on each unit's own value: scaling every
   * handle time by m scales required FTE by m, hence
   *   grid(i, j) = totalFrontLine x (1 - hcPct_i) - demandFactor x m_j
   * When every unit inherits the global, m_j = ht_j / htGlobal and the axis can
   * still be displayed in absolute minutes.
   */
  demandFactor: number;
}

export const portfolioTotals = (results: UnitResult[]): PortfolioTotals => {
  const sum = (f: (r: UnitResult) => number) =>
    results.reduce((acc, r) => acc + f(r), 0);

  const requiredFrontLine = sum((r) => r.requiredFrontLine);

  return {
    units: results.length,
    currentFrontLine: sum((r) => r.currentFrontLine),
    currentManagers: sum((r) => r.currentManagers),
    requiredFrontLine,
    surplus: sum((r) => r.surplus),
    volume: sum((r) => r.volume.value),
    demandFactor: requiredFrontLine,
  };
};

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

export const groupBy = <K extends string>(
  results: UnitResult[],
  key: (r: UnitResult) => K,
): Map<K, UnitResult[]> => {
  const out = new Map<K, UnitResult[]>();
  for (const r of results) {
    const k = key(r);
    const bucket = out.get(k);
    if (bucket) bucket.push(r);
    else out.set(k, [r]);
  }
  return out;
};

/** Rolls up by any grouping, e.g. region, using the same sum-of-rows rule. */
export const rollup = <K extends string>(
  results: UnitResult[],
  key: (r: UnitResult) => K,
): Map<K, PortfolioTotals> => {
  const grouped = groupBy(results, key);
  const out = new Map<K, PortfolioTotals>();
  for (const [k, rows] of grouped) out.set(k, portfolioTotals(rows));
  return out;
};

/** How many units carry a sentinel anywhere in their headcount or cost maps. */
export const countMissing = (c: Case, ctx: Ctx): number =>
  c.units.filter(
    (u) =>
      u.volume === SENTINEL ||
      isMissing(sumRoles(u.headcount, ctx.roles.all)) ||
      isMissing(sumRoles(u.cost, ctx.roles.all)),
  ).length;
