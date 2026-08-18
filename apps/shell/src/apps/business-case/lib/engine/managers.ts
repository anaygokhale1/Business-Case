/**
 * The management layer.
 *
 * G5 — required managers is CEILING(remaining front-line / span), never ROUND and
 * never INT. A fractional manager is not a thing, and rounding down understates
 * the layer you still have to pay for.
 *
 * DECISION 12 — this is computed ONCE at portfolio level, not per unit.
 *
 * That is a deliberate modelling choice with a real consequence, so it is written
 * down here rather than left implicit. CEILING does not commute with addition:
 *
 *     sum_u ceil(remaining_u / span)  >=  ceil( sum_u remaining_u / span )
 *
 * and the gap can be as large as (number of units - 1) whole managers. Per-unit
 * rounding is the operationally true one — you cannot share a fractional manager
 * between two teams — but portfolio rounding reconciles at the level an executive
 * checks the arithmetic, and it keeps this engine numerically identical to the
 * existing skill's workbook. Portfolio was chosen.
 *
 * The implication the UI must honour: any per-unit manager figure shown in the
 * register or a drill-down is an ALLOCATION of the portfolio number, and must be
 * labelled as one. It is not a per-unit calculation.
 */

import type { Alg } from "./alg";
import { FastAlg } from "./alg";
import type { ManagerResult } from "./types";

export interface ManagerInputs<T> {
  remainingFrontLine: T;
  currentManagers: T;
  span: T;
}

export const requiredManagers = <T>(A: Alg<T>, i: ManagerInputs<T>): T =>
  A.named(
    "requiredManagers",
    "Required managers post-reduction",
    "fte",
    A.ceilTo1(A.div(i.remainingFrontLine, i.span)),
  );

export const managerReduction = <T>(A: Alg<T>, i: ManagerInputs<T>): T =>
  A.named(
    "managerReduction",
    "Manager FTE reduction",
    "fte",
    A.sub(i.currentManagers, requiredManagers(A, i)),
  );

/**
 * A negative reduction is legitimate and is deliberately not floored at zero: it
 * means the target span implies MORE managers than are currently in place, which is
 * a finding worth surfacing rather than a number to suppress.
 */
export const computeManagers = (
  remainingFrontLine: number,
  currentManagers: number,
  span: number,
): ManagerResult => {
  const inputs: ManagerInputs<number> = {
    remainingFrontLine: FastAlg.lit({
      id: "remainingFrontLine",
      label: "Remaining front-line FTE",
      uom: "fte",
      value: remainingFrontLine,
    }),
    currentManagers: FastAlg.lit({
      id: "currentManagers",
      label: "Current managers",
      uom: "fte",
      value: currentManagers,
    }),
    span: FastAlg.lit({
      id: "span",
      label: "Target span of control",
      uom: "ratio",
      value: span,
      ref: "SPAN",
    }),
  };

  const required = requiredManagers(FastAlg, inputs);

  return {
    currentManagers,
    remainingFrontLine,
    span,
    requiredManagers: required,
    managerReduction: currentManagers - required,
  };
};

/**
 * The rounding cost of the portfolio choice, for disclosure in the trace.
 *
 * Returns how many additional managers a per-unit calculation would require.
 * Surfacing this is what stops a reviewer who checks one team's arithmetic from
 * concluding the model is wrong.
 */
export const roundingDisclosure = (
  perUnitRemaining: number[],
  span: number,
): { portfolio: number; perUnitSummed: number; delta: number } => {
  const total = perUnitRemaining.reduce((a, b) => a + b, 0);
  const portfolio = FastAlg.ceilTo1(total / span);
  const perUnitSummed = perUnitRemaining.reduce(
    (acc, r) => acc + FastAlg.ceilTo1(r / span),
    0,
  );
  return { portfolio, perUnitSummed, delta: perUnitSummed - portfolio };
};
