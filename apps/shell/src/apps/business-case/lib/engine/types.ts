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
  /**
   * Which region the task was measured in.
   *
   * Absent means portfolio-wide: the task applies to every region that has no
   * study of its own. That is the fallback rather than the default, because a
   * study measured in one region and applied silently to all of them is how a
   * regional difference in how work is done disappears from a model.
   */
  region?: string;
}

export interface Override {
  unitId: string;
  field: string;
  value: number | Sentinel;
  reason: string;
  author: string;
  at: string;
}

/* -------------------------------------------------------------------------- */
/* The capacity model — process study, demand and role parameters              */
/* -------------------------------------------------------------------------- */

/**
 * One leaf of the process taxonomy.
 *
 * `applicability` is what makes a single register serve several transaction shapes: a
 * step may happen on a new submission but not a renewal, and on a bound policy but not
 * a declined one. An EMPTY list means "applies to all", because a study that leaves the
 * flags blank means the step is universal, not that it never happens.
 */
export interface ProcessRow {
  id: string;
  /** Coarse to fine, e.g. ["5 Client Servicing", "5.2 Process Request", ...]. */
  path: string[];
  /** Top-level split, e.g. line of business. */
  lob: string;
  region: string;
  /** Transaction types this step applies to. Empty = all. */
  transactionTypes: string[];
  /** Final statuses this step applies to. Empty = all. */
  statuses: string[];
  /**
   * Role assignment per column, e.g. { current: "UW", target: "UA" }. A column absent
   * from this map, or holding "", is unassigned for that scenario — see G30.
   */
  roles: Record<string, string>;
  /** Minutes for ONE occurrence of the step. */
  ahtMinutes: Driver;
  /**
   * Occurrences per transaction. At or below 1 this reads as the share of transactions
   * where the step happens; above 1 the step happens more than once. Both are legal.
   */
  frequency: Driver;
  /** Minutes to redo the step. Absent means no rework is modelled for this step. */
  reworkMinutes?: Driver;
  /** Share of occurrences that need redoing. */
  reworkFrequency?: Driver;
  /**
   * The study's own stated expected-minutes figure, where it carries one.
   *
   * A real study computes this from the components — but not always. In the study this
   * was modelled on, 170 of 2,229 cells were typed in rather than calculated, and six of
   * those disagreed with their own inputs: hardcoded to 0 while the components said
   * otherwise, evidently to take a step out of scope without deleting its measurements.
   *
   * So the stated figure WINS when present, because it is what the client's own totals
   * use and reproducing those is what makes the model trustworthy to them. G32 reports
   * every divergence, so a deliberate override stays visible and an accidental one gets
   * found.
   */
  statedMinutes?: Driver;
}

/** Capacity parameters for one role. No cost — that is a separate layer. */
export interface RoleCapacity {
  role: string;
  workingHoursPerYear: number;
  utilisationPct: number;
  /**
   * Work assigned here leaves human capacity entirely — an automation target. It still
   * appears in the results with its minutes, so the automation is visible rather than
   * simply missing, but it consumes no FTE.
   */
  automated?: boolean;
  /**
   * A placeholder owner rather than a real team, e.g. "NA" for a step nobody has been
   * assigned yet. Its minutes are reported as undecided scope and never costed or
   * staffed, because pretending someone does the work is the more dangerous error.
   */
  unassigned?: boolean;
  /**
   * Where this role sits — onshore, a hub, a named country.
   *
   * Descriptive, and load-bearing for the cost story: in a right-shift most of the saving
   * comes from work moving somewhere cheaper, not from a cheaper grade doing the same work
   * in the same place. Without the location on the role the two are indistinguishable in
   * the output, and only one of them is a decision anyone can act on.
   *
   * One location per role. A role that genuinely exists in two places at two costs has to
   * be two roles in the study, because a single role name carries no way to say which of
   * its people performed a given step.
   */
  location?: string;
  /**
   * All-in annual cost of one FTE of this role, in this location.
   *
   * Absent means not yet supplied and the sentinel means known-missing. Either way the
   * role's FTE change is still reported, and its cost impact is excluded from the total
   * with the gap stated — never treated as zero, which would read as a role that is free.
   */
  annualCost?: Driver;
}

/** Transactions received for one (lob, transactionType). */
export interface DemandCell {
  lob: string;
  transactionType: string;
  /**
   * Transactions RECEIVED, not transactions completed.
   *
   * This is the definition that matters most in the whole module. A submission that is
   * lost or declined still consumes most of the work a bound one does — in the study
   * this was modelled on, 826 minutes against 957 — so counting only bound policies
   * understates required capacity by nearly a factor of two.
   */
  submissions: Driver;
  /**
   * This cell's own outcome split, as shares summing to 1.
   *
   * Held per cell rather than only per transaction type because the mix genuinely
   * differs by line of business — one book may bind 60% of what it quotes and another
   * 50% — and a single split across both would move required capacity in the wrong
   * direction for each. Falls back to `CapacityStudy.statusShares` when absent.
   */
  outcomeShares?: Record<string, number>;
}

/**
 * Default outcome splits by transaction type, used for any demand cell that does not
 * carry its own.
 *
 * Endorsements are always bound; new submissions are bound, lost or declined. G29
 * requires each set to sum to 1 and does not silently normalise it.
 */
export type StatusShares = Record<string, Record<string, number>>;

export interface CapacityStudy {
  rows: ProcessRow[];
  demand: DemandCell[];
  statusShares: StatusShares;
  roles: RoleCapacity[];
  /** Which role columns the study carries, e.g. ["current", "proposed", "target"]. */
  roleColumns: string[];
}

/**
 * Everything the capacity model needs, as it sits on the case document.
 *
 * `targetColumn` is which role assignment the to-be state reads. A study commonly carries
 * several that disagree with each other, and which one is the target is a decision the
 * case records rather than a property of the file.
 */
export interface CapacityBlock extends CapacityStudy {
  /** The as-is assignment. Almost always "current". */
  baseColumn: string;
  /** The to-be assignment, chosen from `roleColumns`. */
  targetColumn: string;
  /**
   * Surplus copies of duplicate row groups the user has chosen to exclude. Empty by
   * default — G28 never removes a row on its own.
   */
  excludedRowIds: string[];
  /**
   * Share of a shrinking role's reduction that moves into a growing role rather than
   * leaving. 0 means everyone displaced exits; 1 means nobody does.
   *
   * Stated explicitly rather than buried inside a net figure, because it is the assumption
   * the one-time cost is most sensitive to and the first one a reader will challenge.
   */
  redeploymentRate: number;
  /**
   * Cost of filling a growing role that redeployment does not fill, as a share of that
   * role's annual cost. Zero means recruitment cost is not being modelled.
   */
  recruitmentCostPct: number;
  /** Currency the role costs are stated in, e.g. "EUR". Reported, never converted. */
  currency: string;
  /** Where the numbers came from, for the audit trail. */
  source?: {
    studyFile?: string;
    volumesFile?: string;
    importedAt?: string;
  };
}

/**
 * Which model the case is built on.
 *
 * `reduction` is the original shape: a unit register, and a headcount reduction
 * percentage applied to it. `capacity` is the process-study shape: required FTE per role
 * derived from volumes, handle times and rework, with the opportunity expressed as work
 * moving between roles rather than as a percentage cut.
 *
 * Held as an explicit discriminator rather than inferred from whether a study is present,
 * because a case can carry a study for reference while still being modelled as a
 * reduction, and the reader is entitled to know which one produced the numbers.
 */
export type CaseModel = "reduction" | "capacity";

export interface Case {
  schema: "case.workforce.v2";
  /** Defaults to "reduction" when absent, so existing saved cases keep working. */
  model?: CaseModel;
  /**
   * The process time study and its capacity parameters, when one has been uploaded.
   * Typed as `unknown` here and narrowed by the capacity modules to keep this file free
   * of a dependency on them — `types.ts` is imported by everything.
   */
  capacity?: CapacityBlock;
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
