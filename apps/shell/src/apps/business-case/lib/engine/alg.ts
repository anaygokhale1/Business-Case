/**
 * The arithmetic algebra every KPI formula is written against.
 *
 * WHY THIS EXISTS
 *
 * Three consumers need the same formula: the app needs its *value*, the
 * drill-down needs an *unfoldable explanation*, and the workbook needs an
 * *Excel formula string*. Writing the formula once per consumer guarantees they
 * drift — the description ends up saying `a x b` while the code does `a x b x c`
 * and nothing catches it.
 *
 * The two obvious alternatives both fail:
 *   - Template strings plus a bag of recorded intermediates IS writing it twice.
 *   - Recording via Proxy is impossible: JS has no operator overloading, so
 *     `a * b` cannot be intercepted.
 *
 * So each formula is written once against `Alg<T>` and interpreted three ways.
 * There is exactly one formula body, which makes drift structurally impossible.
 *
 * SCOPE — read this before extending
 *
 * `Alg` covers the identity and KPI formulas: roughly the Calculations tab and
 * the sensitivity cells. It is deliberately NOT used for the 36-month phasing
 * recurrence, which is stateful and reads badly in applicative style. Phasing
 * stays plain TypeScript with a hand-written row-pattern emitter, and its parity
 * is covered by row-level value tests. An abstraction claimed to cover
 * everything is how this design fails.
 */

import type { Origin, Provenance, UoM } from "./types";

/* -------------------------------------------------------------------------- */
/* Primitives — defined ONCE, shared by every interpreter                     */
/* -------------------------------------------------------------------------- */

/**
 * G21 numeric representation of the sentinel.
 *
 * NaN is the right choice: it propagates through every arithmetic operation, so
 * a missing input can never silently become 0 and slip into a SUM. Test for it
 * with `isMissing`, never with `=== SENTINEL`.
 */
export const MISSING = Number.NaN;

export const isMissing = (x: number): boolean => Number.isNaN(x);

/**
 * Pre-round applied before every CEILING, in BOTH the TS and Excel interpreters.
 *
 * This is the single most important parity rule in the engine. CEILING is a
 * discontinuity, not a tolerance: if TS computes 24.000000000000004 and Excel
 * gets exactly 24, the answers are 25 managers and 24 managers. No tolerance
 * smooths that, because the outputs are integers. Rounding to 6 decimals first
 * makes both sides land on the same side of the boundary.
 */
export const round6 = (x: number): number =>
  isMissing(x) ? MISSING : Math.round(x * 1e6) / 1e6;

const addN = (a: number, b: number) => a + b;
const subN = (a: number, b: number) => a - b;
const mulN = (a: number, b: number) => a * b;

/** Guarded division: a zero or missing denominator yields the sentinel, never Infinity. */
const divN = (a: number, b: number): number =>
  b === 0 || isMissing(b) || isMissing(a) ? MISSING : a / b;

const ceilTo1N = (a: number): number => (isMissing(a) ? MISSING : Math.ceil(round6(a)));

const sumN = (xs: number[]): number => xs.reduce((acc, x) => acc + x, 0);

const sumprodN = (xs: number[], ys: number[]): number => {
  if (xs.length !== ys.length) {
    throw new Error(`sumprod length mismatch: ${xs.length} vs ${ys.length}`);
  }
  let acc = 0;
  for (let i = 0; i < xs.length; i += 1) acc += xs[i]! * ys[i]!;
  return acc;
};

/* -------------------------------------------------------------------------- */
/* The interface                                                              */
/* -------------------------------------------------------------------------- */

export interface LitSpec {
  /** Stable identifier, used as the Excel defined name when `ref` is absent. */
  id: string;
  label: string;
  uom: UoM;
  value: number;
  /** Where the value came from. Drives the trace leaf AND the own/inherited badge. */
  origin?: Origin;
  /** Excel defined name to emit instead of the literal, e.g. 'SPAN'. */
  ref?: string;
  /** Source / as-of / exclusions, surfaced on hover. */
  provenance?: Provenance;
}

/**
 * Aggregation spec. `excel` lets a formula declare the range expression the
 * workbook should use — `SUM(Register[FTE])` rather than a comma list of 500
 * literals — without the formula body knowing anything about layout.
 */
export interface AggSpec {
  label: string;
  excel?: string;
}

export interface Alg<T> {
  lit(spec: LitSpec): T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  /** Guarded — see divN. */
  div(a: T, b: T): T;
  /** Excel CEILING(x, 1), including the parity pre-round. */
  ceilTo1(a: T): T;
  sum(spec: AggSpec, xs: T[]): T;
  sumprod(spec: AggSpec, xs: T[], ys: T[]): T;
  /**
   * Marks one unfold level in the drill-down and one named cell in the workbook.
   *
   * Unfold depth equals the number of `named()` calls, NOT the number of
   * arithmetic ops. The author controls granularity by placing `named()` — never
   * by writing prose.
   */
  named(id: string, label: string, uom: UoM, a: T): T;
}

/* -------------------------------------------------------------------------- */
/* FastAlg — the hot path                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every op is the plain float op and `named` is the identity. These are
 * monomorphic one-liners, so V8 inlines them and the hot path allocates nothing.
 * This is what makes recomputing 500 units x 3 scenarios cost under a
 * millisecond, and why no web worker is needed.
 */
export const FastAlg: Alg<number> = {
  lit: (spec) => spec.value,
  add: addN,
  sub: subN,
  mul: mulN,
  div: divN,
  ceilTo1: ceilTo1N,
  sum: (_spec, xs) => sumN(xs),
  sumprod: (_spec, xs, ys) => sumprodN(xs, ys),
  named: (_id, _label, _uom, a) => a,
};

/* -------------------------------------------------------------------------- */
/* TraceAlg — the drill-down                                                  */
/* -------------------------------------------------------------------------- */

export type TraceOp =
  | "lit"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "ceil"
  | "sum"
  | "sumprod"
  | "named";

export interface TraceNode {
  op: TraceOp;
  value: number;
  children: TraceNode[];
  /** Present on `named` and `lit` nodes only. */
  id?: string;
  label?: string;
  uom?: UoM;
  origin?: Origin;
  provenance?: Provenance;
  ref?: string;
}

const node = (op: TraceOp, value: number, children: TraceNode[]): TraceNode => ({
  op,
  value,
  children,
});

/**
 * Builds the node tree the drill-down renders. Values come from the same
 * primitives FastAlg uses, so a traced value can never disagree with a computed
 * one.
 */
export const TraceAlg: Alg<TraceNode> = {
  lit: (spec) => ({
    op: "lit",
    value: spec.value,
    children: [],
    id: spec.id,
    label: spec.label,
    uom: spec.uom,
    ...(spec.origin !== undefined ? { origin: spec.origin } : {}),
    ...(spec.provenance !== undefined ? { provenance: spec.provenance } : {}),
    ...(spec.ref !== undefined ? { ref: spec.ref } : {}),
  }),
  add: (a, b) => node("add", addN(a.value, b.value), [a, b]),
  sub: (a, b) => node("sub", subN(a.value, b.value), [a, b]),
  mul: (a, b) => node("mul", mulN(a.value, b.value), [a, b]),
  div: (a, b) => node("div", divN(a.value, b.value), [a, b]),
  ceilTo1: (a) => node("ceil", ceilTo1N(a.value), [a]),
  sum: (spec, xs) => ({
    ...node("sum", sumN(xs.map((x) => x.value)), xs),
    label: spec.label,
  }),
  sumprod: (spec, xs, ys) => ({
    ...node(
      "sumprod",
      sumprodN(
        xs.map((x) => x.value),
        ys.map((y) => y.value),
      ),
      [...xs, ...ys],
    ),
    label: spec.label,
  }),
  named: (id, label, uom, a) => ({
    op: "named",
    value: a.value,
    children: [a],
    id,
    label,
    uom,
  }),
};

/**
 * Collapses unnamed ops into their parent, so an unfold level exists only where
 * the formula author placed `named()`.
 */
export interface TraceLevel {
  id: string;
  label: string;
  uom: UoM;
  value: number;
  /** The next `named` levels beneath this one. */
  children: TraceLevel[];
  /** Leaf inputs contributing directly to this level, with their origin. */
  inputs: TraceNode[];
}

export const toLevels = (n: TraceNode): TraceLevel | null => {
  if (n.op !== "named") return null;
  const children: TraceLevel[] = [];
  const inputs: TraceNode[] = [];

  const walk = (x: TraceNode) => {
    if (x.op === "named") {
      const level = toLevels(x);
      if (level) children.push(level);
      return;
    }
    if (x.op === "lit") {
      inputs.push(x);
      return;
    }
    x.children.forEach(walk);
  };
  n.children.forEach(walk);

  return {
    id: n.id!,
    label: n.label!,
    uom: n.uom!,
    value: n.value,
    children,
    inputs,
  };
};

/* -------------------------------------------------------------------------- */
/* ExcelAlg — the workbook                                                    */
/* -------------------------------------------------------------------------- */

/** Operator precedence, used to parenthesise only where needed. */
const PREC = { ATOM: 0, MULDIV: 2, ADDSUB: 3 } as const;

export interface Cell {
  formula: string;
  prec: number;
}

const wrap = (c: Cell, max: number): string =>
  c.prec > max ? `(${c.formula})` : c.formula;

export interface ExcelAlgResult {
  alg: Alg<Cell>;
  /**
   * Named subexpressions in definition order. Each becomes a real workbook cell
   * with an Excel defined name, so the app's trace levels and the workbook's
   * Calculations rows are two renderings of one structure — which makes parity
   * for these formulas structural rather than merely tested.
   */
  names: Map<string, { label: string; uom: UoM; formula: string }>;
}

const excelNumber = (x: number): string => {
  if (isMissing(x)) throw new Error("cannot emit a sentinel as an Excel literal");
  return String(x);
};

export const createExcelAlg = (): ExcelAlgResult => {
  const names: ExcelAlgResult["names"] = new Map();

  const alg: Alg<Cell> = {
    lit: (spec) => ({
      formula: spec.ref ?? excelNumber(spec.value),
      prec: PREC.ATOM,
    }),
    add: (a, b) => ({
      formula: `${wrap(a, PREC.ADDSUB)}+${wrap(b, PREC.ADDSUB)}`,
      prec: PREC.ADDSUB,
    }),
    // Right operand of a subtraction must be wrapped if it is itself add/sub:
    // a-(b-c) is not a-b-c.
    sub: (a, b) => ({
      formula: `${wrap(a, PREC.ADDSUB)}-${wrap(b, PREC.MULDIV)}`,
      prec: PREC.ADDSUB,
    }),
    mul: (a, b) => ({
      formula: `${wrap(a, PREC.MULDIV)}*${wrap(b, PREC.MULDIV)}`,
      prec: PREC.MULDIV,
    }),
    // Denominators are wrapped unless atomic — conservative, and always correct.
    div: (a, b) => ({
      formula: `${wrap(a, PREC.MULDIV)}/${wrap(b, PREC.ATOM)}`,
      prec: PREC.MULDIV,
    }),
    // The ROUND is the parity rule from `round6`, emitted so Excel lands on the
    // same side of the integer boundary as TypeScript.
    ceilTo1: (a) => ({
      formula: `CEILING(ROUND(${a.formula},6),1)`,
      prec: PREC.ATOM,
    }),
    sum: (spec, xs) => ({
      formula: spec.excel ?? `SUM(${xs.map((x) => x.formula).join(",")})`,
      prec: PREC.ATOM,
    }),
    sumprod: (spec, xs, ys) => ({
      formula:
        spec.excel ??
        `SUMPRODUCT(${xs.map((x) => x.formula).join(",")},${ys
          .map((y) => y.formula)
          .join(",")})`,
      prec: PREC.ATOM,
    }),
    named: (id, label, uom, a) => {
      names.set(id, { label, uom, formula: a.formula });
      // Downstream formulas reference the defined name, so a layout shift cannot
      // break them — the skill's own "Summary shows #REF! after Phasing rows
      // shifted" failure mode.
      return { formula: id, prec: PREC.ATOM };
    },
  };

  return { alg, names };
};
