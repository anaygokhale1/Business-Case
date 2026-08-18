/**
 * QC3 / G4 — blended cost must be the FTE-weighted average, and the sentinel must
 * not be able to sneak in as a silent zero.
 */

import { describe, expect, it } from "vitest";

import { isMissing } from "./alg";
import { computeBlendedCost, flattenCostVectors, portfolioTotals, rollup } from "./aggregate";
import { buildCtx } from "./drivers";
import { computeUnit } from "./identity";
import { divergentBlendFixture, sentinelFixture } from "./__fixtures__/cases";

describe("G4 — blended all-in cost", () => {
  const c = divergentBlendFixture();
  const ctx = buildCtx(c);

  it("weights by FTE rather than taking a simple mean of the rates", () => {
    const frontLine = computeBlendedCost(c, ctx.roles.frontLine);
    // 100 @ 80,000 and 20 @ 120,000 -> 10,400,000 / 120
    expect(frontLine.value).toBeCloseTo(86_666.6667, 4);

    // The naive proxy a reader might expect. Using it would overstate severance by
    // 15% on this fixture.
    const simpleMean = (80_000 + 120_000) / 2;
    expect(simpleMean).toBe(100_000);
    expect(frontLine.value).not.toBeCloseTo(simpleMean, 2);
  });

  it("computes the manager blend separately", () => {
    const managers = computeBlendedCost(c, ctx.roles.managers);
    expect(managers.value).toBeCloseTo(166_666.6667, 4);
  });

  it("computes an all-roles blend across every unit and role", () => {
    const all = computeBlendedCost(c, ctx.roles.all);
    // 12,900,000 / 135
    expect(all.value).toBeCloseTo(95_555.5556, 4);
  });

  it("satisfies the ratio identity blended x totalFte === sumproduct", () => {
    const { fte, cost } = flattenCostVectors(c.units, ctx.roles.all);
    const totalFte = fte.reduce((a, b) => a + b, 0);
    const sumprod = fte.reduce((acc, f, i) => acc + f * cost[i]!, 0);
    const blended = computeBlendedCost(c, ctx.roles.all).value;
    expect(blended * totalFte).toBeCloseTo(sumprod, 6);
  });
});

describe("G21 — sentinels never become a silent zero", () => {
  const c = sentinelFixture();
  const ctx = buildCtx(c);

  it("drops a (unit, role) pair from BOTH vectors when either side is missing", () => {
    const frontLine = computeBlendedCost(c, ctx.roles.frontLine);

    // 30 @ 90,000 and 10 @ 90,000 survive; the 25 processors with a missing cost are
    // excluded from the numerator AND the denominator.
    expect(frontLine.value).toBeCloseTo(90_000, 6);
    expect(frontLine.dropped).toBe(1);

    // This is the number you would get if the FTE stayed in the denominator while its
    // cost read as 0 — which is exactly what Excel does to a text cell inside
    // SUMPRODUCT, and why the export refuses to build in that state.
    const silentZero = (30 * 90_000 + 10 * 90_000) / (30 + 10 + 25);
    expect(silentZero).toBeCloseTo(55_384.6154, 4);
    expect(frontLine.value).not.toBeCloseTo(silentZero, 2);
  });

  it("propagates a missing volume into that unit s required FTE rather than zero", () => {
    const noVolume = computeUnit(c.units[1]!, ctx);
    expect(isMissing(noVolume.requiredFrontLine)).toBe(true);
    expect(noVolume.requiredFrontLine).not.toBe(0);
  });
});

describe("rollups are sums of rows", () => {
  const c = divergentBlendFixture();
  const ctx = buildCtx(c);
  const results = c.units.map((u) => computeUnit(u, ctx));

  it("reconciles every group back to the portfolio total", () => {
    const byRegion = rollup(results, (r) => (r.unitId === "u-large-cheap" ? "NA" : "EU"));
    const total = portfolioTotals(results);
    const summed = [...byRegion.values()].reduce((acc, g) => acc + g.requiredFrontLine, 0);
    expect(summed).toBeCloseTo(total.requiredFrontLine, 10);
  });
});
