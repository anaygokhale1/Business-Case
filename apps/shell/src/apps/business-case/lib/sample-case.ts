/**
 * A synthetic starter case, so the module shows a working model on first open
 * rather than an empty form.
 *
 * Invented company, invented figures — the template's data rule is absolute, and a
 * distinctive real number identifies an engagement to anyone who worked on it.
 *
 * The register is deliberately uneven: some units supply their own utilisation or
 * handle time and some inherit the global. That is the realistic state after a
 * partly-populated import, and it is what makes the own/inherited badges and the
 * per-unit capacity denominator visible instead of theoretical.
 */

import type { Case, Globals, Role, Unit } from "./engine/types";

const ROLES: Role[] = [
  { id: "processor", title: "Claims Processor", tier: "front-line" },
  { id: "lead", title: "Team Lead", tier: "manager" },
];

const GLOBALS: Globals = {
  workingHoursPerYear: 1880,
  utilisationPct: 0.75,
  handleTimeSource: "Manual",
  handleTimeMinutes: 22,
  upliftPct: 0.03,
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

const UNITS: Unit[] = [
  {
    id: "claims-na-east",
    name: "Claims — East",
    region: "North America",
    volume: 486_000,
    utilisationPct: 0.82,
    headcount: { processor: 84, lead: 11 },
    cost: { processor: 84_000, lead: 141_000 },
  },
  {
    id: "claims-na-central",
    name: "Claims — Central",
    region: "North America",
    volume: 312_000,
    headcount: { processor: 61, lead: 8 },
    cost: { processor: 79_000, lead: 136_000 },
  },
  {
    id: "claims-na-west",
    name: "Claims — West",
    region: "North America",
    volume: 198_000,
    utilisationPct: 0.68,
    handleTimeMinutes: 27,
    headcount: { processor: 44, lead: 6 },
    cost: { processor: 92_000, lead: 152_000 },
  },
  {
    id: "policy-na",
    name: "Policy Services",
    region: "North America",
    volume: 254_000,
    handleTimeMinutes: 16,
    headcount: { processor: 38, lead: 5 },
    cost: { processor: 76_000, lead: 133_000 },
  },
  {
    id: "claims-emea-uk",
    name: "Claims — UK",
    region: "Europe",
    volume: 176_000,
    utilisationPct: 0.71,
    headcount: { processor: 39, lead: 5 },
    cost: { processor: 88_000, lead: 148_000 },
  },
  {
    id: "claims-emea-dach",
    name: "Claims — DACH",
    region: "Europe",
    volume: 121_000,
    workingHoursPerYear: 1720,
    utilisationPct: 0.74,
    headcount: { processor: 27, lead: 4 },
    cost: { processor: 95_000, lead: 158_000 },
  },
  {
    id: "policy-emea",
    name: "Policy Services — EMEA",
    region: "Europe",
    volume: 98_000,
    handleTimeMinutes: 19,
    headcount: { processor: 22, lead: 3 },
    cost: { processor: 81_000, lead: 139_000 },
  },
  {
    id: "claims-apac",
    name: "Claims — APAC",
    region: "APAC",
    volume: 143_000,
    utilisationPct: 0.79,
    handleTimeMinutes: 24,
    headcount: { processor: 31, lead: 4 },
    cost: { processor: 58_000, lead: 104_000 },
  },
];

export const createSampleCase = (): Case => ({
  schema: "case.workforce.v2",
  meta: {
    company: "Northwind Assurance",
    industry: "Insurance / Reinsurance",
    coreProblem: "Capacity Right-sizing",
    initiativeTitle: "Claims Operations Optimisation",
    preparedBy: "Demo User",
    modelDate: "2026-08-18",
    workloadUnitName: "Claims",
    // G20 — fixed, never read from the clock. A model whose numbers move overnight
    // cannot be signed off, and it makes regression testing impossible.
    asOfDate: "2026-08-18",
  },
  globals: structuredClone(GLOBALS),
  scenarios: {
    low: { hcReductionPct: 0.08 },
    base: { hcReductionPct: 0.12 },
    high: { hcReductionPct: 0.18 },
  },
  roles: structuredClone(ROLES),
  units: structuredClone(UNITS),
  timeStudy: [
    { taskType: "New claim intake", minutes: 31, volume: 240_000 },
    { taskType: "Adjustment", minutes: 18, volume: 410_000 },
    { taskType: "Coverage review", minutes: 44, volume: 96_000 },
    { taskType: "Settlement", minutes: 26, volume: 180_000 },
    { taskType: "Reopened claim", minutes: 38, volume: 42_000 },
  ],
  overrides: [],
  provenance: {},
});
