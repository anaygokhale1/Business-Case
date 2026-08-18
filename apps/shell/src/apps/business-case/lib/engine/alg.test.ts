import { describe, expect, it } from "vitest";

import {
  FastAlg,
  MISSING,
  TraceAlg,
  createExcelAlg,
  isMissing,
  round6,
  toLevels,
} from "./alg";
import { buildCtx } from "./drivers";
import { liftUnitInputs, requiredFrontLine } from "./identity";
import { twoUnitUtilisationFixture } from "./__fixtures__/cases";

const ref = (name: string) =>
  ({ id: name, label: name, uom: "ratio" as const, value: 1, ref: name });

describe("ceilTo1 — the parity pre-round", () => {
  it("lands on the same integer as Excel when the input carries float noise", () => {
    const noisy = (0.1 + 0.2) / 0.1; // 3.0000000000000004

    // This is the whole point: the unguarded ceiling disagrees by a whole unit.
    expect(Math.ceil(noisy)).toBe(4);
    expect(FastAlg.ceilTo1(noisy)).toBe(3);
  });

  it("still ceilings genuinely fractional values", () => {
    expect(FastAlg.ceilTo1(12.5)).toBe(13);
    expect(FastAlg.ceilTo1(12.000001)).toBe(13);
    expect(FastAlg.ceilTo1(12)).toBe(12);
  });

  it("emits the pre-round into the Excel formula, so both sides round first", () => {
    const { alg } = createExcelAlg();
    const cell = alg.ceilTo1(alg.div(alg.lit(ref("STAFF")), alg.lit(ref("SPAN"))));
    expect(cell.formula).toBe("CEILING(ROUND(STAFF/SPAN,6),1)");
  });

  it("round6 propagates the sentinel rather than turning it into 0", () => {
    expect(isMissing(round6(MISSING))).toBe(true);
  });
});

describe("guarded division (G21)", () => {
  it("yields the sentinel, never Infinity, on a zero denominator", () => {
    const r = FastAlg.div(100, 0);
    expect(isMissing(r)).toBe(true);
    expect(Number.isFinite(r)).toBe(false);
    expect(r).not.toBe(Infinity);
  });

  it("propagates a missing numerator", () => {
    expect(isMissing(FastAlg.div(MISSING, 10))).toBe(true);
  });

  it("a missing value poisons an aggregate instead of silently reading as 0", () => {
    // This is the behaviour G21 exists to produce. A silent 0 would enter the SUM
    // and understate nothing visibly; a sentinel makes the gap impossible to miss.
    expect(isMissing(FastAlg.add(MISSING, 500))).toBe(true);
  });
});

describe("ExcelAlg — precedence and defined names", () => {
  it("parenthesises only where the maths requires it", () => {
    const { alg } = createExcelAlg();
    const a = alg.lit(ref("A"));
    const b = alg.lit(ref("B"));
    const c = alg.lit(ref("C"));

    expect(alg.sub(alg.sub(a, b), c).formula).toBe("A-B-C");
    // a-(b-c) is NOT a-b-c, so this one must keep its parentheses.
    expect(alg.sub(a, alg.sub(b, c)).formula).toBe("A-(B-C)");
    expect(alg.div(a, alg.mul(b, c)).formula).toBe("A/(B*C)");
    expect(alg.mul(alg.add(a, b), c).formula).toBe("(A+B)*C");
    expect(alg.add(alg.mul(a, b), c).formula).toBe("A*B+C");
  });

  it("registers each named level and references it by name downstream", () => {
    const { alg, names } = createExcelAlg();
    const inner = alg.named(
      "blendedAllIn",
      "Blended all-in cost",
      "usd",
      alg.div(alg.lit(ref("SP")), alg.lit(ref("TOT"))),
    );
    const outer = alg.named("severance", "Severance", "usd", alg.mul(inner, alg.lit(ref("WK"))));

    expect(names.get("blendedAllIn")?.formula).toBe("SP/TOT");
    // The outer formula points at the defined name, not at a re-inlined copy — so a
    // layout shift cannot break the reference.
    expect(names.get("severance")?.formula).toBe("blendedAllIn*WK");
    expect(outer.formula).toBe("severance");
  });

  it("uses a declared range expression instead of a comma list when given one", () => {
    const { alg } = createExcelAlg();
    const cell = alg.sum({ label: "SUM(FTE)", excel: "SUM(Register[FTE])" }, [
      alg.lit(ref("A")),
      alg.lit(ref("B")),
    ]);
    expect(cell.formula).toBe("SUM(Register[FTE])");
  });
});

describe("TraceAlg — values cannot disagree with FastAlg", () => {
  const c = twoUnitUtilisationFixture();
  const ctx = buildCtx(c);
  const unit = c.units[0]!;

  it("produces the same number as the hot path for the same formula body", () => {
    const fast = requiredFrontLine(FastAlg, liftUnitInputs(FastAlg, unit, ctx));
    const traced = requiredFrontLine(TraceAlg, liftUnitInputs(TraceAlg, unit, ctx));
    expect(traced.value).toBe(fast);
  });

  it("unfolds one level per named() call, not one per arithmetic op", () => {
    const traced = requiredFrontLine(TraceAlg, liftUnitInputs(TraceAlg, unit, ctx));
    const level = toLevels(traced);

    expect(level).not.toBeNull();
    expect(level!.id).toBe("requiredFrontLine");
    // effectiveHours is the only nested named() level, though there are five
    // arithmetic ops between them.
    expect(level!.children.map((ch) => ch.id)).toEqual(["effectiveHours"]);
    expect(level!.inputs.map((i) => i.id).sort()).toEqual([
      "handleTimeMinutes",
      "minutesPerHour",
      "one",
      "upliftPct",
      "volume",
    ]);
  });

  it("carries the origin onto leaf inputs, so the trace and the badge agree", () => {
    const traced = requiredFrontLine(TraceAlg, liftUnitInputs(TraceAlg, unit, ctx));
    const level = toLevels(traced)!;
    const ht = level.inputs.find((i) => i.id === "handleTimeMinutes");
    // This unit does not supply its own handle time.
    expect(ht?.origin).toBe("inherited");
  });
});
