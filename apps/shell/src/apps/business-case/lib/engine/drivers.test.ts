/**
 * Driver resolution and QC6 / G11 — the handle-time toggle.
 *
 * The register introduces a case the skill never had: a unit that supplies its own
 * handle time. So the toggle assertion is stronger than the skill's version —
 * flipping the source must move every INHERITING unit and must move NO unit that
 * carries its own value.
 */

import { describe, expect, it } from "vitest";

import { isMissing } from "./alg";
import { buildCtx, driverCoverage, resolveDriver, resolveGlobals, weightedAverageHandleTime } from "./drivers";
import { computeUnit } from "./identity";
import { makeCase, mixedHandleTimeFixture, sentinelFixture } from "./__fixtures__/cases";

describe("resolveDriver — three states, none of them zero", () => {
  const c = mixedHandleTimeFixture();
  const ctx = buildCtx(c);

  it("reports own for a value the unit supplies", () => {
    const r = resolveDriver(c.units[1]!, ctx, "handleTimeMinutes");
    expect(r).toEqual({ value: 35, origin: "own" });
  });

  it("reports inherited and returns the global when the key is absent", () => {
    const r = resolveDriver(c.units[0]!, ctx, "handleTimeMinutes");
    expect(r).toEqual({ value: 20, origin: "inherited" });
  });

  it("reports missing, not zero, for an explicit sentinel", () => {
    const s = sentinelFixture();
    const sctx = buildCtx(s);
    const r = resolveDriver(
      { ...s.units[0]!, utilisationPct: "n/a" },
      sctx,
      "utilisationPct",
    );
    expect(r.origin).toBe("missing");
    expect(isMissing(r.value)).toBe(true);
    expect(r.value).not.toBe(0);
  });
});

describe("G11 — handle-time toggle scope", () => {
  const manual = mixedHandleTimeFixture();
  const study = {
    ...manual,
    globals: { ...manual.globals, handleTimeSource: "Time Study" as const },
    // Volume-weighted average = (20x100 + 40x100) / 200 = 30
    timeStudy: [
      { taskType: "New Policy", minutes: 20, volume: 100 },
      { taskType: "Endorsement", minutes: 40, volume: 100 },
    ],
  };

  it("computes a volume-weighted average, not a simple mean", () => {
    expect(weightedAverageHandleTime(study.timeStudy)).toBe(30);

    const skewed = [
      { taskType: "A", minutes: 10, volume: 900 },
      { taskType: "B", minutes: 100, volume: 100 },
    ];
    // Simple mean would be 55; the weighted figure is 19.
    expect(weightedAverageHandleTime(skewed)).toBe(19);
  });

  it("moves every unit that inherits the global handle time", () => {
    const before = computeUnit(manual.units[0]!, buildCtx(manual));
    const after = computeUnit(study.units[0]!, buildCtx(study));

    expect(before.handleTimeMinutes.value).toBe(20);
    expect(after.handleTimeMinutes.value).toBe(30);
    expect(after.requiredFrontLine).toBeGreaterThan(before.requiredFrontLine);
  });

  it("moves NO unit that supplies its own handle time", () => {
    const before = computeUnit(manual.units[1]!, buildCtx(manual));
    const after = computeUnit(study.units[1]!, buildCtx(study));

    expect(before.handleTimeMinutes).toEqual({ value: 35, origin: "own" });
    expect(after.handleTimeMinutes).toEqual({ value: 35, origin: "own" });
    expect(after.requiredFrontLine).toBe(before.requiredFrontLine);
  });

  it("falls back to the manual entry when the study has no volume", () => {
    const empty = { ...study, timeStudy: [] };
    const g = resolveGlobals(empty);
    // An empty study must not be able to zero the model's handle time.
    expect(g.activeHandleTimeMinutes).toBe(20);
    expect(g.activeHandleTimeOrigin).toBe("default");
  });
});

describe("driver coverage — the ingest match report read-out", () => {
  it("counts own, inherited and missing per driver", () => {
    const c = makeCase([
      {
        id: "a",
        name: "A",
        region: "NA",
        volume: 1000,
        handleTimeMinutes: 25,
        headcount: { processor: 10 },
        cost: { processor: 90_000 },
      },
      {
        id: "b",
        name: "B",
        region: "NA",
        volume: 1000,
        headcount: { processor: 10 },
        cost: { processor: 90_000 },
      },
      {
        id: "c",
        name: "C",
        region: "EU",
        volume: 1000,
        handleTimeMinutes: "n/a",
        headcount: { processor: 10 },
        cost: { processor: 90_000 },
      },
    ]);

    const ht = driverCoverage(c).find((d) => d.driver === "handleTimeMinutes")!;
    expect(ht).toEqual({
      driver: "handleTimeMinutes",
      own: 1,
      inherited: 1,
      missing: 1,
      total: 3,
    });
  });
});
