/**
 * Synthetic process-study fixtures.
 *
 * GOVERNANCE — invented processes, invented figures, invented roles. These reproduce the
 * STRUCTURE of a real capacity study (a taxonomy several levels deep, applicability
 * flags, several role columns, a rework rate) and none of its content. A distinctive
 * handle time identifies an engagement to anyone who worked on it.
 *
 * The numbers are chosen so every expected result is computable by hand and written out
 * in the test. A fixture whose expected values were produced by running the code proves
 * only that the code is consistent with itself.
 */

import type {
  CapacityStudy,
  DemandCell,
  ProcessRow,
  RoleCapacity,
  StatusShares,
} from "../process-study";

export const ROLE_COLUMNS = ["current", "proposed", "target"];

/**
 * Capacity parameters chosen to make the arithmetic legible.
 *
 * Reviewer works 2,000 hours at 60% -> 1,200 productive hours -> 72,000 minutes.
 * Processor works 1,800 hours at 80% -> 1,440 productive hours -> 86,400 minutes.
 * The two differ on BOTH axes on purpose: a single blended denominator would misstate
 * each of them, and these are exactly the roles work moves between.
 */
export const ROLES: RoleCapacity[] = [
  { role: "Reviewer", workingHoursPerYear: 2000, utilisationPct: 0.6 },
  { role: "Processor", workingHoursPerYear: 1800, utilisationPct: 0.8 },
  { role: "Automation", workingHoursPerYear: 0, utilisationPct: 0, automated: true },
  { role: "Unowned", workingHoursPerYear: 0, utilisationPct: 0, unassigned: true },
];

const row = (
  id: string,
  over: Partial<ProcessRow> & Pick<ProcessRow, "ahtMinutes" | "frequency" | "roles">,
): ProcessRow => ({
  id,
  path: ["1 Intake", "1.1 Receive", `1.1.1 ${id}`],
  lob: "Alpha",
  region: "Testland",
  transactionTypes: [],
  statuses: [],
  ...over,
});

/**
 * The base study.
 *
 * Per transaction of type "New":
 *   - step-a: always, 10 min, Reviewer -> Processor        = 10.0
 *   - step-b: 50% of the time, 20 min, Reviewer -> Reviewer = 10.0
 *   - step-c: bound only, 30 min, Reviewer -> Automation    = 30.0 on bound
 *   - step-d: always, 4 min + 25% rework at 8 min, Processor = 1 x (4 + 0.25 x 8) = 6.0
 *
 * So minutes per NEW transaction, current assignment:
 *   Reviewer  = 10 (a) + 10 (b) + 30 x share(Bound) (c)
 *   Processor = 6 (d)
 */
export const baseRows = (): ProcessRow[] => [
  row("step-a", { ahtMinutes: 10, frequency: 1, roles: { current: "Reviewer", proposed: "Processor", target: "Processor" } }),
  row("step-b", { ahtMinutes: 20, frequency: 0.5, roles: { current: "Reviewer", proposed: "Reviewer", target: "Processor" } }),
  row("step-c", {
    ahtMinutes: 30,
    frequency: 1,
    statuses: ["Bound"],
    roles: { current: "Reviewer", proposed: "Automation", target: "Automation" },
  }),
  row("step-d", {
    ahtMinutes: 4,
    frequency: 1,
    reworkMinutes: 8,
    reworkFrequency: 0.25,
    roles: { current: "Processor", proposed: "Processor", target: "Processor" },
  }),
];

/** 60% of new submissions bind, 40% do not. */
export const SHARES: StatusShares = {
  New: { Bound: 0.6, Lost: 0.4 },
};

export const DEMAND: DemandCell[] = [{ lob: "Alpha", transactionType: "New", submissions: 10_000 }];

export const baseStudy = (over: Partial<CapacityStudy> = {}): CapacityStudy => ({
  rows: baseRows(),
  demand: DEMAND,
  statusShares: SHARES,
  roles: ROLES,
  roleColumns: ROLE_COLUMNS,
  ...over,
});

/* -------------------------------------------------------------------------- */
/* Variants, each isolating one defect the real study contained               */
/* -------------------------------------------------------------------------- */

/** A role spelled with a trailing space in one column — the silent-drop bug. */
export const trailingSpaceStudy = (): CapacityStudy => {
  const rows = baseRows();
  rows[0] = { ...rows[0]!, roles: { ...rows[0]!.roles, proposed: "Processor " } };
  return baseStudy({ rows });
};

/** Two rows identical in every field that affects the arithmetic. */
export const duplicateStudy = (): CapacityStudy => {
  const rows = baseRows();
  rows.push({ ...rows[0]!, id: "step-a-copy" });
  return baseStudy({ rows });
};

/** A step with no owner in the target column, and one with no owner anywhere. */
export const unassignedStudy = (): CapacityStudy => {
  const rows = baseRows();
  rows[1] = { ...rows[1]!, roles: { current: "Reviewer" } };
  rows.push(row("step-orphan", { ahtMinutes: 12, frequency: 1, roles: {} }));
  return baseStudy({ rows });
};

/** Outcome shares that do not sum to 100%. */
export const brokenSharesStudy = (): CapacityStudy =>
  baseStudy({ statusShares: { New: { Bound: 0.6, Lost: 0.3 } } });

/** A step whose handle time is unknown rather than zero. */
export const sentinelStudy = (): CapacityStudy => {
  const rows = baseRows();
  rows[3] = { ...rows[3]!, ahtMinutes: "n/a" };
  return baseStudy({ rows });
};

/**
 * A step whose stated figure was typed over the formula, zeroing it while the handle
 * time and frequency still imply 10 minutes.
 */
export const statedOverrideStudy = (): CapacityStudy => {
  const rows = baseRows();
  rows[0] = { ...rows[0]!, statedMinutes: 0 };
  return baseStudy({ rows });
};

/** A role carrying work but no productive-hours basis. */
export const missingParamsStudy = (): CapacityStudy =>
  baseStudy({ roles: ROLES.filter((r) => r.role !== "Processor") });

/**
 * Two lines of business and two transaction types, to exercise the demand loop.
 *
 * Beta's step takes twice as long as Alpha's, so a result that accidentally shares one
 * figure across both lines is visible rather than plausible.
 */
export const twoLobStudy = (): CapacityStudy => ({
  rows: [
    // Tagged to New explicitly, so this fixture isolates the per-line handle time and
    // does not also depend on the "empty list means all types" rule.
    row("alpha-step", {
      lob: "Alpha",
      ahtMinutes: 10,
      frequency: 1,
      transactionTypes: ["New"],
      roles: { current: "Reviewer" },
    }),
    row("beta-step", {
      lob: "Beta",
      ahtMinutes: 20,
      frequency: 1,
      transactionTypes: ["New"],
      roles: { current: "Reviewer" },
    }),
    row("alpha-renewal", {
      lob: "Alpha",
      ahtMinutes: 5,
      frequency: 1,
      transactionTypes: ["Renewal"],
      roles: { current: "Processor" },
    }),
  ],
  demand: [
    { lob: "Alpha", transactionType: "New", submissions: 1_000 },
    { lob: "Beta", transactionType: "New", submissions: 2_000 },
    { lob: "Alpha", transactionType: "Renewal", submissions: 500 },
  ],
  statusShares: { New: { Bound: 1 }, Renewal: { Bound: 1 } },
  roles: ROLES,
  roleColumns: ["current"],
});
