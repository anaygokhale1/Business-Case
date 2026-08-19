/**
 * Region-scoped time study: the handle-time precedence chain, and the reconciliation
 * between a study's volumes and the register's.
 *
 * The precedence is the part worth testing hard. Every step of it is a place where a
 * region could silently inherit how work is done somewhere else, and the resulting
 * number looks entirely plausible.
 */

import { describe, expect, it } from "vitest";

import {
  buildCtx,
  handleTimeByRegion,
  regionsWithStudy,
  resolveDriver,
  resolveGlobals,
  studyRowsForRegion,
  studyRowsPortfolio,
  studyVolume,
} from "./drivers";
import { checkInvariants } from "./qc";
import type { Case, TimeStudyRow, Unit } from "./types";
import { makeCase } from "./__fixtures__/cases";

const unit = (id: string, region: string, over: Partial<Unit> = {}): Unit => ({
  id,
  name: id,
  region,
  volume: 100_000,
  headcount: { processor: 40, lead: 5 },
  cost: { processor: 80_000, lead: 130_000 },
  ...over,
});

/** Two regions, one of which has measured its own tasks. */
const twoRegionStudy = (): TimeStudyRow[] => [
  { taskType: "Intake", minutes: 30, volume: 60_000, region: "Europe" },
  { taskType: "Adjustment", minutes: 10, volume: 40_000, region: "Europe" },
  { taskType: "Portfolio intake", minutes: 20, volume: 100_000 },
];

const studiedCase = (over: Partial<Case["globals"]> = {}) =>
  ({
    ...makeCase([unit("europe", "Europe"), unit("apac", "APAC")], {
      handleTimeSource: "Time Study",
      handleTimeMinutes: 99,
      ...over,
    }),
    timeStudy: twoRegionStudy(),
  }) satisfies Case;

describe("study scoping", () => {
  it("separates regional rows from portfolio rows", () => {
    const rows = twoRegionStudy();
    expect(studyRowsForRegion(rows, "Europe")).toHaveLength(2);
    expect(studyRowsPortfolio(rows)).toHaveLength(1);
    expect(regionsWithStudy(rows)).toEqual(["Europe"]);
  });

  it("weights each region's average by that region's own volumes", () => {
    // (30x60000 + 10x40000) / 100000 = 22
    expect(handleTimeByRegion(twoRegionStudy())).toEqual({ Europe: 22 });
  });

  it("gives a region with rows but no volume no entry at all", () => {
    // Not a NaN entry: downstream would then have to tell it apart from a genuine
    // sentinel, and the fallback chain already handles "no figure here".
    const rows: TimeStudyRow[] = [{ taskType: "Untimed", minutes: 15, volume: 0, region: "APAC" }];
    expect(handleTimeByRegion(rows)).toEqual({});
  });
});

describe("handle-time precedence", () => {
  it("a region with its own study uses its own average", () => {
    const c = studiedCase();
    const resolved = resolveDriver(c.units[0]!, buildCtx(c), "handleTimeMinutes");
    expect(resolved).toEqual({ value: 22, origin: "inherited" });
  });

  it("a region without one falls back to the portfolio study, not to another region", () => {
    const c = studiedCase();
    const resolved = resolveDriver(c.units[1]!, buildCtx(c), "handleTimeMinutes");
    // 20, the portfolio row — emphatically not Europe's 22. A region inheriting
    // another region's measured handle time is the failure this chain exists to stop.
    expect(resolved.value).toBe(20);
  });

  it("falls back to the manual figure when there are no portfolio rows", () => {
    const c: Case = {
      ...studiedCase(),
      timeStudy: twoRegionStudy().filter((r) => r.region !== undefined),
    };
    expect(resolveDriver(c.units[1]!, buildCtx(c), "handleTimeMinutes").value).toBe(99);
  });

  it("a unit's own value still beats every study", () => {
    const c: Case = {
      ...studiedCase(),
      units: [unit("europe", "Europe", { handleTimeMinutes: 41 }), unit("apac", "APAC")],
    };
    expect(resolveDriver(c.units[0]!, buildCtx(c), "handleTimeMinutes")).toEqual({
      value: 41,
      origin: "own",
    });
  });

  it("the Manual toggle switches every region back to the manual figure at once", () => {
    const c = studiedCase({ handleTimeSource: "Manual" });
    const ctx = buildCtx(c);
    // The toggle has exactly one effect in one place: an empty region map.
    expect(ctx.handleTimeByRegion).toEqual({});
    expect(resolveDriver(c.units[0]!, ctx, "handleTimeMinutes").value).toBe(99);
    expect(resolveDriver(c.units[1]!, ctx, "handleTimeMinutes").value).toBe(99);
  });

  it("a regional study does not leak into the global fallback", () => {
    const c = studiedCase();
    // resolveGlobals sees only the portfolio rows, so the "global" handle time is 20.
    expect(resolveGlobals(c).activeHandleTimeMinutes).toBe(20);
  });

  it("a region-only study never becomes the global figure", () => {
    const c: Case = {
      ...studiedCase(),
      timeStudy: twoRegionStudy().filter((r) => r.region !== undefined),
    };
    // 99, the manual entry — not Europe's measured 22. Europe still gets 22 through
    // the region map; what it must not do is become everyone else's assumption.
    expect(resolveGlobals(c).activeHandleTimeMinutes).toBe(99);
    expect(resolveDriver(c.units[0]!, buildCtx(c), "handleTimeMinutes").value).toBe(22);
  });

  it("reports missing rather than zero when there is nothing to inherit", () => {
    // A 0 here would make required FTE 0 and report the whole current headcount as
    // surplus — a confident, catastrophic, entirely silent answer.
    const c: Case = {
      ...studiedCase({ handleTimeMinutes: 0 }),
      timeStudy: twoRegionStudy().filter((r) => r.region !== undefined),
    };
    const resolved = resolveDriver(c.units[1]!, buildCtx(c), "handleTimeMinutes");
    expect(Number.isNaN(resolved.value)).toBe(true);
    expect(resolved.origin).toBe("missing");
  });
});

describe("the identity the study rests on", () => {
  it("sum of (task volume x minutes) equals total volume x weighted average", () => {
    const rows = studyRowsForRegion(twoRegionStudy(), "Europe");
    const longhand = rows.reduce((acc, r) => acc + r.volume * r.minutes, 0);
    const shorthand = studyVolume(rows) * handleTimeByRegion(twoRegionStudy())["Europe"]!;
    // This is why a study that does not tie to the register is a real problem rather
    // than a rounding difference: the two forms are algebraically the same, so the
    // only way they disagree is if the volumes describe different populations.
    expect(shorthand).toBeCloseTo(longhand, 9);
  });
});

describe("G25 reconciliation", () => {
  const g25 = (c: Case) => checkInvariants(c).filter((v) => v.id === "G25");

  it("flags a study covering a different volume from the register", () => {
    // Europe's study covers 100,000 but the register says 250,000.
    const c: Case = {
      ...studiedCase(),
      units: [unit("europe", "Europe", { volume: 250_000 }), unit("apac", "APAC")],
    };
    const found = g25(c);
    expect(found.some((v) => v.message.includes("40%"))).toBe(true);
    expect(found.every((v) => v.severity === "warn")).toBe(true);
  });

  it("stays quiet when the study ties to the register", () => {
    const c: Case = {
      ...studiedCase(),
      units: [unit("europe", "Europe", { volume: 100_000 })],
    };
    expect(g25(c).filter((v) => v.message.includes("covers"))).toEqual([]);
  });

  it("names the regions falling back to the portfolio figure", () => {
    const c = studiedCase();
    expect(g25(c).some((v) => v.message.includes("APAC"))).toBe(true);
  });

  it("says nothing at all while the source is Manual", () => {
    // The study is recorded but not in use, so reconciling it would be noise.
    const c = studiedCase({ handleTimeSource: "Manual" });
    expect(g25(c)).toEqual([]);
  });

  it("never blocks the export", () => {
    // A study that covers part of the work is a judgement call to state, not an
    // arithmetic error. Only things that would silently corrupt a number block.
    const c: Case = {
      ...studiedCase(),
      units: [unit("europe", "Europe", { volume: 999_999 })],
    };
    expect(g25(c).every((v) => v.severity === "warn")).toBe(true);
  });
});
