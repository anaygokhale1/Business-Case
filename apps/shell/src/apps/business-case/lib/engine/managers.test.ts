/**
 * QC4 / G5 — the management layer.
 *
 * The test asserts the mathematical DEFINITION of a ceiling rather than "calls
 * Math.ceil". An oracle survives any reimplementation; a spy on the call does not.
 */

import { describe, expect, it } from "vitest";

import { computeManagers, roundingDisclosure } from "./managers";

describe("G5 — required managers", () => {
  it("rounds up, never down", () => {
    expect(computeManagers(100, 15, 8).requiredManagers).toBe(13); // 12.5 -> 13
    expect(computeManagers(96, 15, 8).requiredManagers).toBe(12); // exact
    expect(computeManagers(97, 15, 8).requiredManagers).toBe(13);
  });

  it("satisfies the ceiling oracle across a sweep", () => {
    for (let remaining = 0; remaining <= 240; remaining += 3.5) {
      for (const span of [5, 7, 8, 10, 12.5]) {
        const { requiredManagers: m } = computeManagers(remaining, 20, span);

        expect(Number.isInteger(m)).toBe(true);
        expect(m).toBeGreaterThanOrEqual(0);
        // m is the smallest integer whose span covers the remaining staff.
        expect(m * span).toBeGreaterThanOrEqual(remaining - 1e-9);
        expect((m - 1) * span).toBeLessThan(remaining);
      }
    }
  });

  it("never returns a negative manager count", () => {
    expect(computeManagers(0, 10, 8).requiredManagers).toBe(0);
  });

  it("reports a negative reduction rather than suppressing it", () => {
    // Span implies more managers than are in place. That is a finding, not a number
    // to floor at zero.
    const r = computeManagers(200, 5, 8);
    expect(r.requiredManagers).toBe(25);
    expect(r.managerReduction).toBe(-20);
  });

  it("is immune to float noise on the boundary", () => {
    // 96 staff at span 8 is exactly 12. Accumulated noise must not tip it to 13.
    const noisyRemaining = Array.from({ length: 96 }, () => 0.1).reduce((a, b) => a + b, 0) * 10;
    expect(noisyRemaining).not.toBe(96); // the noise is real
    expect(computeManagers(noisyRemaining, 15, 8).requiredManagers).toBe(12);
  });
});

describe("decision 12 — portfolio rounding, disclosed", () => {
  it("quantifies what per-unit rounding would have added", () => {
    // Three units of 10 remaining staff each, span 8.
    // Portfolio: ceil(30/8) = 4.  Per unit: 3 x ceil(10/8) = 3 x 2 = 6.
    const d = roundingDisclosure([10, 10, 10], 8);
    expect(d.portfolio).toBe(4);
    expect(d.perUnitSummed).toBe(6);
    expect(d.delta).toBe(2);
  });

  it("shows the gap growing with the number of units", () => {
    // 10 units of 10 staff, span 8: per-unit 10 x ceil(1.25) = 20, portfolio
    // ceil(100/8) = 13, so 7 managers of divergence.
    const few = roundingDisclosure(Array.from({ length: 10 }, () => 10), 8);
    expect(few).toMatchObject({ portfolio: 13, perUnitSummed: 20, delta: 7 });

    // 100 units: per-unit 200, portfolio ceil(1000/8) = 125, so 75 managers.
    // This is why the choice matters — at a six-figure blended cost, 75 managers is
    // roughly $10m of annual savings appearing or disappearing on a rounding
    // convention alone.
    const many = roundingDisclosure(Array.from({ length: 100 }, () => 10), 8);
    expect(many).toMatchObject({ portfolio: 125, perUnitSummed: 200, delta: 75 });

    expect(many.delta).toBeGreaterThan(few.delta);
  });

  it("agrees with the portfolio figure when every unit divides exactly", () => {
    const d = roundingDisclosure([16, 24, 8], 8);
    expect(d.delta).toBe(0);
  });
});
