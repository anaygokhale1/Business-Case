/**
 * The KPI formulas, written once each against Alg<T>.
 *
 * Every formula here is read three ways: FastAlg for the value the app renders,
 * TraceAlg for the drill-down that unfolds it with substituted numbers, and
 * ExcelAlg for the formula string the exported workbook contains. That is the
 * mechanism that stops the explanation, the number and the workbook drifting
 * apart — there is one formula body, so there is nothing to keep in sync.
 *
 * Placement of `named()` is the editorial decision in this file: each one becomes
 * an expandable level in the drill-down and a named cell in the workbook, so it
 * marks a quantity a reader would ask about. Everything between two `named()`
 * calls renders inline as one expression.
 */

import type { Alg } from "./alg";
import type { UnitResult, UoM } from "./types";

/** Inline constant. Constants are literals like any other input, so they appear in the trace. */
const k = <T>(A: Alg<T>, id: string, label: string, uom: UoM, value: number): T =>
  A.lit({ id, label, uom, value, origin: "input" });

export interface KpiInputs<T> {
  currentFrontLine: T;
  hcReductionPct: T;
  managerReduction: T;
  blendedFrontLineCost: T;
  blendedManagerCost: T;
  blendedAllIn: T;
  severanceWeeks: T;
  consultingCost: T;
  horizonYears: T;
}

export const staffReduction = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "staffReduction",
    "Front-line FTE reduction",
    "fte",
    A.mul(i.currentFrontLine, i.hcReductionPct),
  );

export const grossSavings = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "grossSavings",
    "Total gross annual savings",
    "usd",
    A.add(
      A.mul(staffReduction(A, i), i.blendedFrontLineCost),
      A.mul(i.managerReduction, i.blendedManagerCost),
    ),
  );

export const totalReduction = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "totalReduction",
    "Total FTE reduction",
    "fte",
    A.add(staffReduction(A, i), i.managerReduction),
  );

/**
 * G4 — severance uses the TRUE blended all-in cost, never savings per FTE. The
 * two differ whenever the roles being removed have a different cost mix from the
 * organisation as a whole, which is almost always.
 */
export const severance = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "severance",
    "One-time severance",
    "usd",
    A.mul(
      A.mul(totalReduction(A, i), i.blendedAllIn),
      A.div(i.severanceWeeks, k(A, "weeksPerYear", "Weeks per year", "count", 52)),
    ),
  );

export const oneTimeCost = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "oneTimeCost",
    "Total one-time cost",
    "usd",
    A.add(severance(A, i), i.consultingCost),
  );

export const year1Net = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "year1Net",
    "Year 1 net benefit",
    "usd",
    A.sub(grossSavings(A, i), oneTimeCost(A, i)),
  );

/**
 * Simple payback in months.
 *
 * Consulting cost is inside the numerator deliberately. The skill omits it from
 * its phasing grid but includes it in its simple payback, so the two disagree and
 * the phasing figure flatters the case. One definition, used everywhere.
 */
export const paybackMonths = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "paybackMonths",
    "Simple payback",
    "months",
    A.mul(
      A.div(oneTimeCost(A, i), grossSavings(A, i)),
      k(A, "monthsPerYear", "Months per year", "count", 12),
    ),
  );

/** G19 — the multiplier is the horizon cell, never a literal 3. */
export const horizonGross = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "horizonGross",
    "Horizon gross savings",
    "usd",
    A.mul(grossSavings(A, i), i.horizonYears),
  );

export const horizonNet = <T>(A: Alg<T>, i: KpiInputs<T>): T =>
  A.named(
    "horizonNet",
    "Horizon net savings",
    "usd",
    A.sub(horizonGross(A, i), oneTimeCost(A, i)),
  );

/**
 * G19 — multi-year LABELS are functions of the horizon too, not static strings.
 * There is deliberately nowhere in this codebase to write "3-Year Net Savings":
 * a workbook that says "5-Year" above three years of data is the failure these
 * exist to prevent.
 */
export const horizonLabel = (years: number, suffix: string): string =>
  `${years}-Year ${suffix}`;

/** Lifts a plain numeric input set into Alg literals, carrying Excel names for the export. */
export const liftKpiInputs = <T>(
  A: Alg<T>,
  raw: {
    currentFrontLine: number;
    hcReductionPct: number;
    managerReduction: number;
    blendedFrontLineCost: number;
    blendedManagerCost: number;
    blendedAllIn: number;
    severanceWeeks: number;
    consultingCost: number;
    horizonYears: number;
  },
): KpiInputs<T> => ({
  currentFrontLine: A.lit({
    id: "currentFrontLine",
    label: "Current front-line FTE",
    uom: "fte",
    value: raw.currentFrontLine,
    ref: "CURRENT_FRONTLINE",
  }),
  hcReductionPct: A.lit({
    id: "hcReductionPct",
    label: "Headcount reduction",
    uom: "pct",
    value: raw.hcReductionPct,
    ref: "HC_REDUCTION",
  }),
  managerReduction: A.lit({
    id: "managerReduction",
    label: "Manager FTE reduction",
    uom: "fte",
    value: raw.managerReduction,
    ref: "MGR_REDUCTION",
  }),
  blendedFrontLineCost: A.lit({
    id: "blendedFrontLineCost",
    label: "Blended front-line cost",
    uom: "usd",
    value: raw.blendedFrontLineCost,
    ref: "BLENDED_FRONTLINE",
  }),
  blendedManagerCost: A.lit({
    id: "blendedManagerCost",
    label: "Blended manager cost",
    uom: "usd",
    value: raw.blendedManagerCost,
    ref: "BLENDED_MANAGER",
  }),
  blendedAllIn: A.lit({
    id: "blendedAllIn",
    label: "Blended all-in cost per FTE",
    uom: "usd",
    value: raw.blendedAllIn,
    ref: "BLENDED_ALLIN",
  }),
  severanceWeeks: A.lit({
    id: "severanceWeeks",
    label: "Severance weeks",
    uom: "count",
    value: raw.severanceWeeks,
    ref: "SEV_WEEKS",
  }),
  consultingCost: A.lit({
    id: "consultingCost",
    label: "Consulting / transition cost",
    uom: "usd",
    value: raw.consultingCost,
    ref: "CONSULTING",
  }),
  horizonYears: A.lit({
    id: "horizonYears",
    label: "Time horizon",
    uom: "count",
    value: raw.horizonYears,
    ref: "HORIZON",
  }),
});

/** Total front-line FTE across the register — a sum of rows (G18). */
export const sumFrontLine = (units: UnitResult[]): number =>
  units.reduce((acc, u) => acc + u.currentFrontLine, 0);
