/**
 * QC16 / G18 — multi-unit aggregation liveness.
 *
 * This is the test that catches the single most expensive class of error in a
 * capacity model: applying one unit's productive hours to another unit's volume, or
 * dividing a portfolio volume by an averaged denominator. Both produce plausible
 * numbers and neither raises an error.
 */

import { describe, expect, it } from "vitest";

import { portfolioTotals } from "./aggregate";
import { buildCtx } from "./drivers";
import { computeUnit } from "./identity";
import { twoUnitUtilisationFixture } from "./__fixtures__/cases";

const c = twoUnitUtilisationFixture();
const ctx = buildCtx(c);
const results = c.units.map((u) => computeUnit(u, ctx));
const totals = portfolioTotals(results);

// Both units: 100,000 volume, 20 min handle time, 1,880 hours, 0% uplift.
// The ONLY difference is utilisation, i.e. the capacity denominator.
const VOLUME = 100_000;
const HT = 20;
const HOURS = 1880;
const effHigh = HOURS * 0.85; // 1,598
const effLow = HOURS * 0.6; //  1,128

const quotient = (eff: number, volume = VOLUME) => (volume * HT) / (eff * 60);

describe("per-unit capacity identity", () => {
  it("divides each unit by its own effective hours", () => {
    expect(results[0]!.effectiveHours.value).toBeCloseTo(effHigh, 10);
    expect(results[1]!.effectiveHours.value).toBeCloseTo(effLow, 10);
    expect(results[0]!.requiredFrontLine).toBeCloseTo(quotient(effHigh), 10);
    expect(results[1]!.requiredFrontLine).toBeCloseTo(quotient(effLow), 10);
  });

  it("marks the utilisation override as the unit s own value", () => {
    expect(results[0]!.effectiveHours.origin).toBe("own");
  });
});

describe("G18 — the total is the sum of the rows", () => {
  const sumOfQuotients = quotient(effHigh) + quotient(effLow);

  it("equals the sum of the per-unit quotients", () => {
    expect(totals.requiredFrontLine).toBeCloseTo(sumOfQuotients, 10);
  });

  it("is NOT the portfolio volume over either single unit s effective hours", () => {
    // The scalar-reference bug: one unit's denominator applied to all volume.
    expect(totals.requiredFrontLine).not.toBeCloseTo(quotient(effHigh, VOLUME * 2), 6);
    expect(totals.requiredFrontLine).not.toBeCloseTo(quotient(effLow, VOLUME * 2), 6);
  });

  it("STRICTLY exceeds the same maths on an averaged denominator", () => {
    // 1/x is convex, so by Jensen the sum of quotients is strictly greater than the
    // quotient of the average whenever the denominators differ. Asserting the
    // direction and the strictness matters: a plain inequality could pass by
    // rounding coincidence, a strict directional bound cannot.
    const averagedDenominator = quotient((effHigh + effLow) / 2, VOLUME * 2);
    expect(totals.requiredFrontLine).toBeGreaterThan(averagedDenominator);
    expect(totals.requiredFrontLine - averagedDenominator).toBeGreaterThan(1);
  });

  it("keeps surplus consistent between the rows and the total", () => {
    expect(totals.surplus).toBeCloseTo(totals.currentFrontLine - totals.requiredFrontLine, 10);
    expect(totals.surplus).toBeCloseTo(
      results.reduce((acc, r) => acc + r.surplus, 0),
      10,
    );
  });
});

describe("G18 — the demand factor stays live per unit", () => {
  it("moves when only one unit s utilisation changes", () => {
    const before = totals.demandFactor;

    const nudged = {
      ...c,
      units: c.units.map((u) =>
        u.id === "u-low" ? { ...u, utilisationPct: 0.7 } : u,
      ),
    };
    const after = portfolioTotals(
      nudged.units.map((u) => computeUnit(u, buildCtx(nudged))),
    ).demandFactor;

    // A grid that does not move on a single unit's utilisation is still bound to a
    // scalar denominator somewhere.
    expect(after).not.toBeCloseTo(before, 6);
    expect(after).toBeLessThan(before); // higher utilisation -> fewer FTE required
  });
});
