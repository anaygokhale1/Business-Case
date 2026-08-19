/**
 * Defaults, choice lists and the benchmark table behind the input form.
 *
 * Everything the skill documents as a default lives here rather than being typed
 * into a field's placeholder, for two reasons. The form has to be able to tell the
 * user which of their numbers are answers and which are defaults it supplied — a
 * default presented as an answer is how a case acquires figures nobody agreed to.
 * And the export needs the same list, so a workbook can badge them identically.
 */

import type {
  Case,
  ExitProfile,
  Globals,
  HandleTimeSource,
  ImplementationCostMode,
  Role,
  SeveranceTiming,
} from "./engine/types";

/* -------------------------------------------------------------------------- */
/* Choice lists — the skill's tappable options                                */
/* -------------------------------------------------------------------------- */

/** Q2. "Other" is last and is a real answer, not a fallback for an empty field. */
export const INDUSTRIES = [
  "Insurance / Reinsurance",
  "Financial Services",
  "Healthcare",
  "Technology / SaaS",
  "Retail / E-commerce",
  "Manufacturing",
  "Other",
] as const;

/** Q3. */
export const CORE_PROBLEMS = [
  "Cost Reduction",
  "Productivity",
  "Capacity Right-sizing",
  "Management layers too deep",
  "Overcapacity",
] as const;

export const HANDLE_TIME_SOURCES: readonly HandleTimeSource[] = ["Manual", "Time Study"];

export const SEVERANCE_TIMINGS: readonly SeveranceTiming[] = [
  "Lump sum at exit",
  "Spread over notice",
];

export const EXIT_PROFILES: readonly ExitProfile[] = ["Front-loaded", "Even", "Back-loaded"];

export const IMPLEMENTATION_COST_MODES: readonly ImplementationCostMode[] = [
  "None",
  "Severance only",
  "Severance + consulting",
];

/* -------------------------------------------------------------------------- */
/* Q15 / Q16 — industry benchmark compensation                                */
/* -------------------------------------------------------------------------- */

export interface Benchmark {
  frontLine: number;
  manager: number;
}

/**
 * The skill's six-industry table, carried across verbatim.
 *
 * These figures arrive with no source, no as-of date and no statement of what they
 * include, so the form labels them **unsourced** and never applies one silently.
 * That is a deliberate limitation of the inherited data, not an oversight here: a
 * benchmark a client cannot trace is a benchmark they will be asked to defend.
 */
export const INDUSTRY_BENCHMARKS: Record<string, Benchmark> = {
  "Insurance / Reinsurance": { frontLine: 85_000, manager: 140_000 },
  "Financial Services": { frontLine: 95_000, manager: 155_000 },
  Healthcare: { frontLine: 75_000, manager: 125_000 },
  "Technology / SaaS": { frontLine: 110_000, manager: 170_000 },
  "Retail / E-commerce": { frontLine: 55_000, manager: 95_000 },
  Manufacturing: { frontLine: 65_000, manager: 110_000 },
};

export const BENCHMARK_CAVEAT =
  "Unsourced industry placeholder — no source, as-of date or inclusion basis. Replace with a client figure before this case is shown to anyone.";

export const benchmarkFor = (industry: string): Benchmark | null =>
  INDUSTRY_BENCHMARKS[industry] ?? null;

/* -------------------------------------------------------------------------- */
/* Documented defaults                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Standard phase-weight profiles. Each row sums to exactly 1 — G9 treats a profile
 * that does not as an error rather than normalising it, so these must be exact.
 */
export const STANDARD_PHASE_WEIGHTS: Record<ExitProfile, number[]> = {
  "Front-loaded": [0.5, 0.3, 0.15, 0.05],
  Even: [0.25, 0.25, 0.25, 0.25],
  "Back-loaded": [0.05, 0.15, 0.3, 0.5],
};

/** Q7, Q8, Q13, Q26, Q28, Q31–Q35 — every figure the skill documents as a default. */
export const DEFAULT_GLOBALS: Globals = {
  workingHoursPerYear: 1880,
  utilisationPct: 0.75,
  handleTimeSource: "Manual",
  // No default, deliberately. The skill documents none, and required FTE is directly
  // proportional to this number — a plausible-looking 20 nobody confirmed would set
  // the whole capacity conclusion. Q20 is required and blocks until answered.
  handleTimeMinutes: 0,
  upliftPct: 0,
  spanOfControl: 8,
  severanceWeeks: 8,
  severanceTiming: "Lump sum at exit",
  implementationCosts: "Severance + consulting",
  horizonYears: 3,
  consultingCost: 0,
  noticeMonths: 2,
  phaseCount: 4,
  monthsPerPhase: 3,
  exitProfile: "Front-loaded",
  phaseWeights: STANDARD_PHASE_WEIGHTS,
};

/**
 * Which global fields carry a documented default, and what it is.
 *
 * The form reads this to badge a field "default" until the user changes it. Keyed
 * on the `Globals` field name so a renamed field fails to compile rather than
 * silently losing its badge.
 */
export const GLOBAL_DEFAULT_LABELS: Partial<Record<keyof Globals, string>> = {
  workingHoursPerYear: "1,880 hrs/yr",
  utilisationPct: "75%",
  spanOfControl: "1:8",
  severanceWeeks: "8 weeks",
  horizonYears: "3 years",
  noticeMonths: "2 months",
  phaseCount: "4 phases",
  monthsPerPhase: "3 months",
};

/**
 * Q23–Q25 — the skill's *example* spread, not a default.
 *
 * The skill writes these as "e.g. 8% / 12% / 18%", and the reduction target is the
 * single input the headline number is most sensitive to. So a blank case starts at
 * zero and the form offers this spread as a button the user presses, rather than
 * arriving pre-filled and being reported as an answer.
 */
export const SUGGESTED_SCENARIOS = {
  low: { hcReductionPct: 0.08 },
  base: { hcReductionPct: 0.12 },
  high: { hcReductionPct: 0.18 },
} as const;

const EMPTY_SCENARIOS = {
  low: { hcReductionPct: 0 },
  base: { hcReductionPct: 0 },
  high: { hcReductionPct: 0 },
} as const;

/* -------------------------------------------------------------------------- */
/* Blank case                                                                 */
/* -------------------------------------------------------------------------- */

/** Q9, Q10 — two tiers to start, extensible via Q14. */
export const STARTER_ROLES: Role[] = [
  { id: "front-line", title: "", tier: "front-line" },
  { id: "manager", title: "", tier: "manager" },
];

/**
 * An empty case.
 *
 * Text answers start as "" and numeric globals start at their documented default,
 * which is the honest encoding of the difference between the two: the skill has a
 * default for working hours and does not have one for the company's name.
 *
 * `asOfDate` must be passed in. The engine bans reading the clock (G20), and that
 * ban is worth nothing if this factory quietly calls `new Date()` on its behalf.
 */
export const createBlankCase = (asOfDate: string): Case => ({
  schema: "case.workforce.v2",
  meta: {
    company: "",
    industry: "",
    coreProblem: "",
    initiativeTitle: "",
    preparedBy: "",
    modelDate: asOfDate,
    asOfDate,
    workloadUnitName: "",
  },
  globals: structuredClone(DEFAULT_GLOBALS),
  scenarios: structuredClone(EMPTY_SCENARIOS),
  roles: structuredClone(STARTER_ROLES),
  units: [],
  timeStudy: [],
  overrides: [],
  provenance: {},
});
