/**
 * The capacity identity, per unit.
 *
 *   required units = (volume x time per unit x (1 + uplift)) / capacity per resource unit
 *   surplus        = current - required
 *
 * G23 — every function here takes ONE unit plus the context. None takes the unit
 * array, so a per-unit computation structurally cannot read a sibling row.
 * `identity.ts` must never import `aggregate.ts`; a dependency rule enforces it.
 *
 * G18 — because required FTE divides by *this unit's own* effective hours, the
 * portfolio total must be the SUM of these per-unit results. Never divide a
 * portfolio volume by an averaged denominator: averaging the denominator and
 * averaging the quotient are different numbers, and 1/x is convex so they can
 * never coincidentally agree.
 */

import type { Alg } from "./alg";
import { FastAlg } from "./alg";
import type { Ctx } from "./drivers";
import { resolveDriver, resolveVolume, sumRoles } from "./drivers";
import type { Unit, UnitResult, UoM } from "./types";

/** Inline constant. Constants are literals like any other input, so they appear in the trace. */
const k = <T>(A: Alg<T>, id: string, label: string, uom: UoM, value: number): T =>
  A.lit({ id, label, uom, value, origin: "input" });

export interface UnitInputs<T> {
  volume: T;
  handleTimeMinutes: T;
  upliftPct: T;
  workingHoursPerYear: T;
  utilisationPct: T;
  currentFrontLine: T;
}

/** Working hours x utilisation. The per-unit capacity denominator. */
export const effectiveHours = <T>(A: Alg<T>, i: UnitInputs<T>): T =>
  A.named(
    "effectiveHours",
    "Effective productive hours",
    "hours",
    A.mul(i.workingHoursPerYear, i.utilisationPct),
  );

export const requiredFrontLine = <T>(A: Alg<T>, i: UnitInputs<T>): T =>
  A.named(
    "requiredFrontLine",
    "Required front-line FTE",
    "fte",
    A.div(
      A.mul(
        A.mul(i.volume, i.handleTimeMinutes),
        A.add(k(A, "one", "One", "ratio", 1), i.upliftPct),
      ),
      A.mul(effectiveHours(A, i), k(A, "minutesPerHour", "Minutes per hour", "min", 60)),
    ),
  );

export const surplus = <T>(A: Alg<T>, i: UnitInputs<T>): T =>
  A.named(
    "surplus",
    "Capacity surplus / (deficit)",
    "fte",
    A.sub(i.currentFrontLine, requiredFrontLine(A, i)),
  );

/**
 * Lifts a unit's resolved drivers into `Alg` literals, carrying the origin so the
 * trace leaf and the own/inherited badge read the same metadata.
 */
export const liftUnitInputs = <T>(A: Alg<T>, unit: Unit, ctx: Ctx): UnitInputs<T> => {
  const volume = resolveVolume(unit);
  const handleTime = resolveDriver(unit, ctx, "handleTimeMinutes");
  const uplift = resolveDriver(unit, ctx, "upliftPct");
  const hours = resolveDriver(unit, ctx, "workingHoursPerYear");
  const utilisation = resolveDriver(unit, ctx, "utilisationPct");

  return {
    volume: A.lit({
      id: "volume",
      label: "Annual volume",
      uom: "count",
      value: volume.value,
      origin: volume.origin,
    }),
    handleTimeMinutes: A.lit({
      id: "handleTimeMinutes",
      label: "Handle time per unit",
      uom: "min",
      value: handleTime.value,
      origin: handleTime.origin,
    }),
    upliftPct: A.lit({
      id: "upliftPct",
      label: "Volume uplift",
      uom: "pct",
      value: uplift.value,
      origin: uplift.origin,
    }),
    workingHoursPerYear: A.lit({
      id: "workingHoursPerYear",
      label: "Working hours per year",
      uom: "hours",
      value: hours.value,
      origin: hours.origin,
    }),
    utilisationPct: A.lit({
      id: "utilisationPct",
      label: "Utilisation",
      uom: "pct",
      value: utilisation.value,
      origin: utilisation.origin,
    }),
    currentFrontLine: A.lit({
      id: "currentFrontLine",
      label: "Current front-line FTE",
      uom: "fte",
      value: sumRoles(unit.headcount, ctx.roles.frontLine),
      origin: "own",
    }),
  };
};

/**
 * The hot path. Uses FastAlg, which allocates nothing after inlining — this is why
 * 500 units x 3 scenarios recomputes in about a millisecond and no web worker is
 * needed.
 */
export const computeUnit = (unit: Unit, ctx: Ctx): UnitResult => {
  const inputs = liftUnitInputs(FastAlg, unit, ctx);
  const hours = resolveDriver(unit, ctx, "workingHoursPerYear");
  const utilisation = resolveDriver(unit, ctx, "utilisationPct");
  const handleTime = resolveDriver(unit, ctx, "handleTimeMinutes");
  const uplift = resolveDriver(unit, ctx, "upliftPct");
  const volume = resolveVolume(unit);

  const required = requiredFrontLine(FastAlg, inputs);
  const currentFrontLine = sumRoles(unit.headcount, ctx.roles.frontLine);

  return {
    unitId: unit.id,
    region: unit.region,
    effectiveHours: {
      value: effectiveHours(FastAlg, inputs),
      // The composite inherits the weaker origin of its two inputs.
      origin:
        hours.origin === "own" || utilisation.origin === "own" ? "own" : hours.origin,
    },
    handleTimeMinutes: handleTime,
    upliftPct: uplift,
    volume,
    currentFrontLine,
    currentManagers: sumRoles(unit.headcount, ctx.roles.managers),
    requiredFrontLine: required,
    surplus: currentFrontLine - required,
  };
};
