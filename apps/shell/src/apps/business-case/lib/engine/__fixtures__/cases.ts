/**
 * Test fixtures.
 *
 * GOVERNANCE — invented companies and invented figures only. Never a real
 * portfolio company, never a real engagement's numbers, not even anonymised: a
 * distinctive figure identifies a deal to anyone who worked on it.
 */

import type { Case, Globals, Role, Unit } from "../types";
import { SENTINEL } from "../types";

export const DEFAULT_GLOBALS: Globals = {
  workingHoursPerYear: 1880,
  utilisationPct: 0.75,
  handleTimeSource: "Manual",
  handleTimeMinutes: 20,
  upliftPct: 0,
  spanOfControl: 8,
  severanceWeeks: 8,
  severanceTiming: "Lump sum at exit",
  implementationCosts: "Severance + consulting",
  horizonYears: 3,
  consultingCost: 250_000,
  noticeMonths: 2,
  phaseCount: 4,
  monthsPerPhase: 3,
  exitProfile: "Front-loaded",
  phaseWeights: {
    "Front-loaded": [0.5, 0.3, 0.15, 0.05],
    Even: [0.25, 0.25, 0.25, 0.25],
    "Back-loaded": [0.05, 0.15, 0.3, 0.5],
  },
};

export const ROLES: Role[] = [
  { id: "processor", title: "Claims Processor", tier: "front-line" },
  { id: "lead", title: "Team Lead", tier: "manager" },
];

/**
 * Every fixture gets a DEEP copy of the defaults.
 *
 * A shallow spread would share the nested `phaseWeights` object across every case
 * in the suite, so one test mutating a weight would silently corrupt every test
 * that ran after it. Tests must be independent of execution order.
 */
export const makeCase = (units: Unit[], globals: Partial<Globals> = {}): Case => ({
  schema: "case.workforce.v2",
  meta: {
    company: "Northwind Assurance",
    industry: "Insurance / Reinsurance",
    coreProblem: "Capacity Right-sizing",
    initiativeTitle: "Operations Optimisation Programme",
    preparedBy: "Test Fixture",
    modelDate: "2026-01-15",
    // G20 — fixed, never Date.now(). Golden-file regression is impossible otherwise.
    asOfDate: "2026-01-15",
    workloadUnitName: "Claims",
  },
  globals: { ...structuredClone(DEFAULT_GLOBALS), ...globals },
  scenarios: {
    low: { hcReductionPct: 0.08 },
    base: { hcReductionPct: 0.12 },
    high: { hcReductionPct: 0.18 },
  },
  roles: ROLES,
  units,
  timeStudy: [],
  overrides: [],
  provenance: {},
});

/**
 * G18 / QC16 — two units differing ONLY in utilisation.
 *
 * Identical volume, identical handle time, identical working hours. The only
 * difference is the capacity denominator, which is precisely the variable that
 * makes "sum the quotients" and "divide by the average denominator" disagree.
 */
export const twoUnitUtilisationFixture = (): Case =>
  makeCase([
    {
      id: "u-high",
      name: "Claims — High Utilisation",
      region: "North America",
      volume: 100_000,
      utilisationPct: 0.85,
      headcount: { processor: 40, lead: 5 },
      cost: { processor: 80_000, lead: 150_000 },
    },
    {
      id: "u-low",
      name: "Claims — Low Utilisation",
      region: "Europe",
      volume: 100_000,
      utilisationPct: 0.6,
      headcount: { processor: 40, lead: 5 },
      cost: { processor: 80_000, lead: 150_000 },
    },
  ]);

/**
 * G4 — a case where the naive proxies and the true blended figure diverge.
 *
 * A simple mean of the two front-line rates is 100,000; the FTE-weighted figure is
 * 86,666.67, because the cheap unit carries five times the headcount. Using the
 * mean would overstate severance by 15%.
 */
export const divergentBlendFixture = (): Case =>
  makeCase([
    {
      id: "u-large-cheap",
      name: "Shared Services",
      region: "North America",
      volume: 400_000,
      headcount: { processor: 100, lead: 10 },
      cost: { processor: 80_000, lead: 150_000 },
    },
    {
      id: "u-small-dear",
      name: "Specialty Underwriting",
      region: "Europe",
      volume: 60_000,
      headcount: { processor: 20, lead: 5 },
      cost: { processor: 120_000, lead: 200_000 },
    },
  ]);

/** G21 — one unit with a known-missing volume and one with a known-missing cost. */
export const sentinelFixture = (): Case =>
  makeCase([
    {
      id: "u-ok",
      name: "Complete Unit",
      region: "North America",
      volume: 100_000,
      headcount: { processor: 30, lead: 4 },
      cost: { processor: 90_000, lead: 160_000 },
    },
    {
      id: "u-no-volume",
      name: "Volume Not Supplied",
      region: "North America",
      volume: SENTINEL,
      headcount: { processor: 10, lead: 2 },
      cost: { processor: 90_000, lead: 160_000 },
    },
    {
      id: "u-no-cost",
      name: "Cost Not Supplied",
      region: "Europe",
      volume: 50_000,
      headcount: { processor: 25, lead: 3 },
      cost: { processor: SENTINEL, lead: 160_000 },
    },
  ]);

/** A unit that supplies its own handle time, used to prove the G11 toggle scope. */
export const mixedHandleTimeFixture = (): Case =>
  makeCase(
    [
      {
        id: "u-inherits",
        name: "Inherits Global Handle Time",
        region: "North America",
        volume: 100_000,
        headcount: { processor: 30, lead: 4 },
        cost: { processor: 90_000, lead: 160_000 },
      },
      {
        id: "u-own-ht",
        name: "Supplies Own Handle Time",
        region: "Europe",
        volume: 100_000,
        handleTimeMinutes: 35,
        headcount: { processor: 30, lead: 4 },
        cost: { processor: 90_000, lead: 160_000 },
      },
    ],
    {
      handleTimeSource: "Manual",
      handleTimeMinutes: 20,
    },
  );
