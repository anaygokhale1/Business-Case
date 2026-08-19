/**
 * Runtime invariants — the skill's guardrails as executable assertions.
 *
 * The repository's own rule is that a guardrail which is only documented is a
 * guardrail that will be broken. So each rule that survives the port to an app
 * lands here, and `checkInvariants` is called from three places:
 *
 *   1. A dev-only banner in the app, so a violation is visible while modelling.
 *   2. Every engine test.
 *   3. The export endpoint, which REFUSES to build on any error-severity
 *      violation. That third one is the real enforcement point: a violated
 *      invariant must never reach a client as a confident-looking workbook.
 *
 * Rules expressed in the type system instead of here — G21 sentinel arithmetic,
 * G22 label literals, G23 row locality — are deliberately absent. A compile error
 * is cheaper than a runtime check and cannot be skipped.
 */

import { isMissing } from "./alg";
import { computeBlendedCost, flattenCostVectors, portfolioTotals } from "./aggregate";
import type { Ctx } from "./drivers";
import {
  buildCtx,
  regionsWithStudy,
  studyRowsForRegion,
  studyVolume,
} from "./drivers";
import { computeUnit } from "./identity";
import type { Case, ScenarioKey, UnitResult } from "./types";
import { SCENARIO_KEYS, SENTINEL } from "./types";

export type Severity = "error" | "warn";

export interface Violation {
  /** The guardrail id, so a failure names the rule it broke. */
  id: string;
  severity: Severity;
  message: string;
  /** Dotted path into the case, where one applies. */
  path?: string;
  expected?: string | number;
  actual?: string | number;
}

/** Errors block the export. Warnings are surfaced and do not. */
export const blocksExport = (violations: Violation[]): boolean =>
  violations.some((v) => v.severity === "error");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const checkInvariants = (
  c: Case,
  opts: { ctx?: Ctx; results?: UnitResult[] } = {},
): Violation[] => {
  const v: Violation[] = [];
  const ctx = opts.ctx ?? buildCtx(c);
  const results = opts.results ?? c.units.map((u) => computeUnit(u, ctx));

  /* ---------------------------------------------------------------------- */
  /* Structural integrity                                                   */
  /* ---------------------------------------------------------------------- */

  const unitIds = new Set<string>();
  for (const u of c.units) {
    if (unitIds.has(u.id)) {
      v.push({
        id: "STRUCT",
        severity: "error",
        message: `Duplicate unit id "${u.id}". Two rows sharing an id merge their denominators, which is the aggregation bug G18 exists to prevent.`,
        path: `units.${u.id}`,
      });
    }
    unitIds.add(u.id);
  }

  const roleIds = new Set<string>();
  for (const r of c.roles) {
    if (roleIds.has(r.id)) {
      v.push({
        id: "STRUCT",
        severity: "error",
        message: `Duplicate role id "${r.id}".`,
        path: `roles.${r.id}`,
      });
    }
    roleIds.add(r.id);
  }

  if (ctx.roles.frontLine.length === 0) {
    v.push({
      id: "STRUCT",
      severity: "error",
      message:
        "No front-line role defined. The capacity identity has nothing to size, so every required-FTE figure is meaningless.",
      path: "roles",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G20 — determinism                                                      */
  /* ---------------------------------------------------------------------- */

  if (!ISO_DATE.test(c.meta.asOfDate)) {
    v.push({
      id: "G20",
      severity: "error",
      message:
        "asOfDate must be an ISO yyyy-mm-dd string. All date arithmetic reads it, and a model whose numbers move overnight cannot be signed off.",
      path: "meta.asOfDate",
      actual: c.meta.asOfDate,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G19 — horizon                                                          */
  /* ---------------------------------------------------------------------- */

  const h = c.globals.horizonYears;
  if (!Number.isInteger(h) || h < 1 || h > 10) {
    v.push({
      id: "G19",
      severity: "error",
      message: "Time horizon must be a whole number of years between 1 and 10.",
      path: "globals.horizonYears",
      actual: h,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G9 — phase weights                                                     */
  /* ---------------------------------------------------------------------- */

  for (const [profile, weights] of Object.entries(c.globals.phaseWeights)) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 1e-9) {
      v.push({
        id: "G9",
        // Deliberately NOT silently normalised. Normalising here would make the app
        // disagree with the workbook's red sum-check cell, which is the worst of both
        // worlds: two answers and no signal.
        severity: profile === c.globals.exitProfile ? "error" : "warn",
        message: `Exit profile "${profile}" weights sum to ${(total * 100).toFixed(1)}%, not 100%. Exit totals and payback are wrong until this is fixed.`,
        path: `globals.phaseWeights.${profile}`,
        expected: 1,
        actual: total,
      });
    }
    if (weights.length !== c.globals.phaseCount) {
      v.push({
        id: "G9",
        severity: "warn",
        message: `Exit profile "${profile}" has ${weights.length} weights but ${c.globals.phaseCount} phases are configured.`,
        path: `globals.phaseWeights.${profile}`,
        expected: c.globals.phaseCount,
        actual: weights.length,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* G5 — span of control                                                   */
  /* ---------------------------------------------------------------------- */

  if (!(c.globals.spanOfControl > 0)) {
    v.push({
      id: "G5",
      severity: "error",
      message:
        "Span of control must be greater than zero, or required managers is a division by zero.",
      path: "globals.spanOfControl",
      actual: c.globals.spanOfControl,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G8 — scenario coherence                                                */
  /* ---------------------------------------------------------------------- */

  const pcts = SCENARIO_KEYS.map((k) => c.scenarios[k].hcReductionPct);
  for (const [i, key] of SCENARIO_KEYS.entries()) {
    const pct = pcts[i]!;
    if (!(pct >= 0 && pct < 1)) {
      v.push({
        id: "G8",
        severity: "error",
        message: `${key} headcount reduction must be at least 0% and under 100%.`,
        path: `scenarios.${key}.hcReductionPct`,
        actual: pct,
      });
    }
  }
  if (!(pcts[0]! <= pcts[1]! && pcts[1]! <= pcts[2]!)) {
    v.push({
      id: "G8",
      severity: "warn",
      message:
        "Scenario reductions are not monotonic across Low, Base and High. Legal, but a reader will assume the ordering — label it deliberately or reorder.",
      path: "scenarios",
      actual: pcts.join(" / "),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G18 — totals reconcile to the rows                                     */
  /* ---------------------------------------------------------------------- */

  const totals = portfolioTotals(results);
  const independentSum = results.reduce(
    (acc, r) => acc + (isMissing(r.requiredFrontLine) ? 0 : r.requiredFrontLine),
    0,
  );
  const liveRows = results.filter((r) => !isMissing(r.requiredFrontLine));
  if (
    liveRows.length === results.length &&
    Math.abs(totals.requiredFrontLine - independentSum) > 1e-6
  ) {
    v.push({
      id: "G18",
      severity: "error",
      message:
        "Portfolio required FTE does not equal the sum of the per-unit rows. A total recomputed from aggregated inputs is a different number, because averaging a denominator is not averaging the quotient.",
      expected: independentSum,
      actual: totals.requiredFrontLine,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G4 — blended cost identity                                             */
  /* ---------------------------------------------------------------------- */

  const blended = computeBlendedCost(c, ctx.roles.all);
  if (!isMissing(blended.value)) {
    const { fte, cost } = flattenCostVectors(c.units, ctx.roles.all);
    const totalFte = fte.reduce((a, b) => a + b, 0);
    const sumprod = fte.reduce((acc, f, i) => acc + f * cost[i]!, 0);
    if (Math.abs(blended.value * totalFte - sumprod) > 1e-6 * Math.max(1, sumprod)) {
      v.push({
        id: "G4",
        severity: "error",
        message:
          "Blended all-in cost fails the weighting identity. It must be SUMPRODUCT(fte, cost) / SUM(fte), never total savings divided by headcount reduced.",
        expected: sumprod,
        actual: blended.value * totalFte,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* G21 — sentinels, and the SUMPRODUCT trap                               */
  /* ---------------------------------------------------------------------- */

  if (blended.dropped > 0) {
    v.push({
      id: "G21",
      // ERROR, and therefore an export blocker. Excel silently reads a text cell as
      // 0 inside SUMPRODUCT while leaving the FTE in SUM, so the workbook would
      // compute a confidently low blended cost with no error shown. The app can
      // refuse; the workbook cannot.
      severity: "error",
      message: `${blended.dropped} (unit, role) pair(s) have a missing headcount or cost. Excel treats a missing value as 0 inside SUMPRODUCT while keeping the FTE in the denominator, so the exported workbook would understate blended cost without showing an error. Supply the values or remove the roles.`,
      actual: blended.dropped,
    });
  }

  const missingVolume = c.units.filter((u) => u.volume === SENTINEL);
  if (missingVolume.length > 0) {
    v.push({
      id: "G21",
      severity: "warn",
      message: `${missingVolume.length} of ${c.units.length} unit(s) have no volume, so they contribute no required FTE. Any portfolio total therefore covers ${c.units.length - missingVolume.length} of ${c.units.length} units.`,
      actual: missingVolume.map((u) => u.id).join(", "),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* G25 — a time study must reconcile to the register it is used with       */
  /* ---------------------------------------------------------------------- */

  if (c.globals.handleTimeSource === "Time Study") {
    for (const region of regionsWithStudy(c.timeStudy)) {
      const rows = studyRowsForRegion(c.timeStudy, region);
      const studied = studyVolume(rows);
      const registered = c.units
        .filter((u) => u.region === region)
        .reduce((acc, u) => acc + (typeof u.volume === "number" ? u.volume : 0), 0);

      if (studied === 0 || registered === 0) continue;

      // Sigma(task volume x task minutes) is identically equal to
      // (total volume) x (weighted average handle time). So a study whose volumes do
      // not tie to the register is not a rounding difference — it means the study
      // covers a different population than the case is sizing, and the weighted
      // average is therefore an average over the wrong mix of tasks.
      const ratio = studied / registered;
      if (Math.abs(ratio - 1) > 0.02) {
        v.push({
          id: "G25",
          severity: "warn",
          message: `${region}: the time study covers ${Math.round(ratio * 100)}% of the volume in the register (${Math.round(studied).toLocaleString("en-US")} studied vs ${Math.round(registered).toLocaleString("en-US")} registered). The weighted average is only the right handle time if the study covers the same work — otherwise it is weighted by the wrong task mix.`,
          path: `timeStudy.${region}`,
          expected: registered,
          actual: studied,
        });
      }
    }

    const unstudied = c.units
      .map((u) => u.region)
      .filter((region, i, all) => all.indexOf(region) === i)
      .filter((region) => !regionsWithStudy(c.timeStudy).includes(region));

    if (unstudied.length > 0 && regionsWithStudy(c.timeStudy).length > 0) {
      v.push({
        id: "G25",
        severity: "warn",
        message: `${unstudied.length} region(s) have no study of their own and fall back to the portfolio figure: ${unstudied.join(", ")}. Worth stating explicitly — a study measured in one region is not evidence about another.`,
        actual: unstudied.join(", "),
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* G24 — coverage must be stated, not assumed                             */
  /* ---------------------------------------------------------------------- */

  if (liveRows.length < results.length) {
    v.push({
      id: "G24",
      severity: "warn",
      message: `Coverage: ${liveRows.length} of ${results.length} units produce a required-FTE figure. Every headline number must carry this statement — a total covering 60% of the portfolio reads as complete otherwise.`,
      actual: `${liveRows.length}/${results.length}`,
    });
  }

  return v;
};

/** Convenience for tests: throw on any error-severity violation. */
export const assertNoErrors = (c: Case): void => {
  const errors = checkInvariants(c).filter((x) => x.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `checkInvariants found ${errors.length} error(s):\n` +
        errors.map((e) => `  [${e.id}] ${e.message}`).join("\n"),
    );
  }
};

/** Which scenario keys exist, for callers iterating the contrast view. */
export const scenarioKeys = (): readonly ScenarioKey[] => SCENARIO_KEYS;
