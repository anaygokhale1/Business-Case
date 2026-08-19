/**
 * Core domain types for the business-case engine.
 *
 * These mirror `case.workforce.v2` — the app <-> export contract. The shape is
 * deliberately a plain JSON document so a case can be exported, diffed and
 * re-imported as a file without a serialisation layer.
 *
 * Two invariants are encoded in the types rather than enforced at runtime:
 *
 *  - G21 (sentinel): a driver is `number` (own value), `SENTINEL` (known-missing)
 *    or an absent key (inherit from globals). It is never `0` standing in for
 *    missing, because `0` enters a SUM and a sentinel does not.
 *  - G22 (labels): scenario keys and enum-valued settings are unions, not
 *    `string`, so comparing against a mistyped literal fails to compile.
 */

/** Unit of measure. Named `uom` everywhere to avoid colliding with `Unit`, which is an org unit. */
export type UoM = "usd" | "fte" | "months" | "pct" | "min" | "hours" | "ratio" | "count";

/** G21 — the single known-missing marker. See `alg.ts` for how it is represented numerically. */
export const SENTINEL = "n/a" as const;
export type Sentinel = typeof SENTINEL;

/**
 * A driver value on a unit.
 *
 * `number`     -> the unit supplies its own value
 * `SENTINEL`   -> the value is known to be missing (must not become 0)
 * key absent   -> inherit the global assumption
 *
 * The distinction between "absent" and "present but undefined" is load-bearing,
 * so `exactOptionalPropertyTypes` must stay on. Edit and ingest paths `delete`
 * the key rather than assigning `undefined`, or JSON round-trips are unstable.
 */
export type Driver = number | Sentinel;

/** Where a resolved value came from. Drives both the trace leaf and the own/inherited badge. */
export type Origin = "own" | "inherited" | "default" | "missing" | "input";

export type ScenarioKey = "low" | "base" | "high";
export const SCENARIO_KEYS: readonly ScenarioKey[] = ["low", "base", "high"] as const;

export type RoleTier = "front-line" | "manager" | "other";

export type HandleTimeSource = "Manual" | "Time Study";
export type SeveranceTiming = "Lump sum at exit" | "Spread over notice";
export type ExitProfile = "Front-loaded" | "Even" | "Back-loaded";

/**
 * Q29 — which implementation costs the case models.
 *
 * Held as a mode rather than inferred from `severanceWeeks === 0`, because "we are
 * not modelling severance" and "severance happens to be zero weeks" are different
 * statements and a reader is entitled to see which one was chosen. The mode is the
 * authority: `effectiveCostInputs` zeroes the components it excludes, so a stale
 * figure left in an input box cannot leak into a total.
 */
export type ImplementationCostMode =
  | "None"
  | "Severance only"
  | "Severance + consulting";

export interface Provenance {
  /** Where the figure came from, e.g. "CBRE Q4 2024, confirmed against JLL". */
  source: string;
  /** As-of date, ISO yyyy-mm-dd. */
  asOf: string;
  /** Escalation already applied, e.g. "8%". */
  escalation?: string;
  /** What the figure excludes, e.g. "contingency, tax". The first question a CFO asks. */
  excludes?: string;
}

export interface Role {
  id: string;
  title: string;
  tier: RoleTier;
}

/**
 * One row of the register. Each unit is a full mini-model: it may carry its own
 * demand and capacity drivers, and inherits any it does not supply.
 *
 * Managers are an exception — see `managers.ts`. A unit carries manager FTE and
 * cost as *inputs*, but required managers is computed once at portfolio level,
 * because CEILING does not commute with addition.
 */
export interface Unit {
  id: string;
  name: string;
  region: string;
  /** Annual demand volume in the workload unit. Required — a unit without demand has no capacity need. */
  volume: Driver;
  /** Optional per-unit overrides. Absent key means inherit from globals. */
  handleTimeMinutes?: Driver;
  workingHoursPerYear?: Driver;
  utilisationPct?: Driver;
  upliftPct?: Driver;
  /** FTE by role id. */
  headcount: Record<string, Driver>;
  /** All-in annual cost per FTE by role id. */
  cost: Record<string, Driver>;
}

export interface Globals {
  workingHoursPerYear: number;
  utilisationPct: number;
  handleTimeSource: HandleTimeSource;
  /** Used when handleTimeSource is 'Manual'; also the fallback when a Time Study is empty. */
  handleTimeMinutes: number;
  upliftPct: number;
  spanOfControl: number;
  severanceWeeks: number;
  severanceTiming: SeveranceTiming;
  /** Q29 — see `ImplementationCostMode`. Gates severance and consulting cost. */
  implementationCosts: ImplementationCostMode;
  /** G19 — every multi-year value and label derives from this. */
  horizonYears: number;
  consultingCost: number;
  noticeMonths: number;
  phaseCount: number;
  monthsPerPhase: number;
  exitProfile: ExitProfile;
  phaseWeights: Record<ExitProfile, number[]>;
}

export interface ScenarioParams {
  hcReductionPct: number;
}

export interface CaseMeta {
  company: string;
  industry: string;
  coreProblem: string;
  initiativeTitle: string;
  preparedBy: string;
  modelDate: string;
  /**
   * Q17 — what one unit of volume is: "Claims", "Transactions Processed". Stored
   * because every volume and handle-time label in the app reads it. A workbook whose
   * columns say "Volume" and "Handle time" without naming the thing being handled
   * forces the reader to guess the denominator.
   */
  workloadUnitName: string;
  /**
   * G20 — all date arithmetic reads this. `Date.now()` is banned in the engine:
   * a model whose numbers move overnight cannot be signed off, and golden-file
   * regression is impossible without it.
   */
  asOfDate: string;
}

export interface TimeStudyRow {
  taskType: string;
  minutes: number;
  volume: number;
}

export interface Override {
  unitId: string;
  field: string;
  value: number | Sentinel;
  reason: string;
  author: string;
  at: string;
}

export interface Case {
  schema: "case.workforce.v2";
  meta: CaseMeta;
  globals: Globals;
  scenarios: Record<ScenarioKey, ScenarioParams>;
  roles: Role[];
  units: Unit[];
  timeStudy: TimeStudyRow[];
  overrides: Override[];
  provenance: Record<string, Provenance>;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

/** A resolved driver plus where it came from. */
export interface Resolved {
  value: number;
  origin: Origin;
}

export interface UnitResult {
  unitId: string;
  /** Carried through so rollups and the register can group without re-joining to the case. */
  region: string;
  /** workingHoursPerYear x utilisationPct, for this unit. */
  effectiveHours: Resolved;
  handleTimeMinutes: Resolved;
  upliftPct: Resolved;
  volume: Resolved;
  /** Front-line FTE currently in place. */
  currentFrontLine: number;
  /** Manager FTE currently in place. Carried, not used to derive required managers. */
  currentManagers: number;
  /** (volume x handleTime x (1+uplift)) / (effectiveHours x 60) */
  requiredFrontLine: number;
  /** currentFrontLine - requiredFrontLine. Positive is surplus. */
  surplus: number;
}

export interface ManagerResult {
  currentManagers: number;
  remainingFrontLine: number;
  span: number;
  requiredManagers: number;
  managerReduction: number;
}
