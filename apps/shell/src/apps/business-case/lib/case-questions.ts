/**
 * The skill's 35 questions, as data.
 *
 * The form is generated from this list rather than the list being a comment beside
 * a hand-built form. That is what makes coverage checkable: a test asserts Q1..Q35
 * each appear exactly once, so a question cannot be dropped during a refactor and
 * noticed later by a client.
 *
 * `answered` is deliberately not "the field is non-empty". A default the user never
 * looked at is not an answer, so questions with a documented default report
 * `status: "default"` until touched. The batch rail shows those separately — a case
 * built entirely from defaults should look different from one that was interviewed.
 */

import { weightedAverageHandleTime } from "./engine/drivers";
import type { Case, CaseModel } from "./engine/types";
import { SENTINEL } from "./engine/types";

export type BatchId =
  | "company"
  | "scope"
  | "roles"
  | "units"
  | "compensation"
  | "workload"
  | "timeStudy"
  | "scenarios"
  | "phasing"
  | "capacityUpload"
  | "roleCapacity";

export type AnswerStatus =
  /** The user supplied it. */
  | "answered"
  /** Holding a documented default the user has not overridden. */
  | "default"
  /** Nothing yet. */
  | "empty"
  /** Not applicable given another answer — e.g. consulting cost when mode is "None". */
  | "n/a";

export interface Question {
  id: string;
  batch: BatchId;
  label: string;
  /** Blocks generating the case. Everything else is optional or has a default. */
  required: boolean;
  status: (c: Case) => AnswerStatus;
  /**
   * Which models the question belongs to. Absent means both.
   *
   * The two models ask for genuinely different things: the reduction model needs a unit
   * register with headcount and cost per row, the capacity model needs a task study and
   * volumes. Marked here rather than inside each `status` function so the answer to
   * "does this question apply?" lives in one place, and so a question cannot be required
   * in a model that has no field for it — which is what would otherwise lock the output
   * tab shut on a case that is complete.
   */
  models?: readonly CaseModel[];
}

/** Only in the reduction model — the unit register and the scenario spread. */
const REDUCTION_ONLY: readonly CaseModel[] = ["reduction"] as const;

/** Only in the capacity model — the task study and its volumes. */
const CAPACITY_ONLY: readonly CaseModel[] = ["capacity"] as const;

/** The model in force. Absent on older saved cases, which are all reduction cases. */
export const modelOf = (c: Case): CaseModel => c.model ?? "reduction";

const appliesToModel = (q: Question, c: Case): boolean =>
  q.models === undefined || q.models.includes(modelOf(c));

export interface Batch {
  id: BatchId;
  label: string;
  /** One line on what the batch is for, shown under the heading. */
  blurb: string;
}

/**
 * Whether a batch can be marked not-applicable.
 *
 * Derived, not declared: a batch is skippable exactly when nothing in it is required.
 * So if a question's requiredness changes, the skip affordance follows automatically
 * and cannot drift out of step with it. Batches that carry a required answer are not
 * skippable, and the form says which answers are the reason rather than showing a
 * disabled button with no explanation.
 */
export const isSkippable = (c: Case, id: BatchId): boolean =>
  !QUESTIONS.some((q) => q.batch === id && q.required && appliesToModel(q, c));

export const BATCHES: readonly Batch[] = [
  {
    id: "company",
    label: "Company & initiative",
    blurb: "The cover block. Everything here appears on the case, so it is what the reader sees first.",
  },
  {
    id: "scope",
    label: "Scope & regions",
    blurb:
      "Name each region in scope. Every region starts as one row you can split into teams later, and carries its own productive-hours denominator.",
  },
  {
    id: "roles",
    label: "Roles & span",
    blurb:
      "The role tiers being modelled and the target manager-to-staff ratio. Front-line roles drive the capacity identity; manager roles are sized from the span.",
  },
  {
    id: "units",
    label: "Units & headcount",
    blurb:
      "Current FTE by role for each row. This is the register the whole case is built from — totals are the sum of these rows, never a portfolio figure divided by an average.",
  },
  {
    id: "compensation",
    label: "Compensation",
    blurb:
      "All-in annual cost per FTE: salary, benefits and employer taxes. Cost per row, so a low-cost region cannot be masked by a portfolio average.",
  },
  {
    id: "workload",
    label: "Workload & demand",
    blurb:
      "Annual volume, how long one unit of work takes, and any growth over the horizon. This is the demand side of the identity.",
  },
  {
    id: "timeStudy",
    // Named for what it produces rather than what it is, because the capacity uploads are
    // also a time study and two rail items called "Time study" is a coin toss for the user.
    label: "Handle-time study",
    blurb:
      "Optional. Task-level times and volumes for the register model, from which a volume-weighted average handle time is derived. Only used when the handle-time source is set to Time Study.",
  },
  {
    id: "scenarios",
    label: "Scenarios & severance",
    blurb:
      "The Low / Base / High reduction spread, the severance basis, and the horizon every multi-year figure is computed over.",
  },
  {
    id: "capacityUpload",
    label: "Time study & volumes",
    blurb:
      "Upload a time study and a volumes study. The study says how long each task takes and who does it now and in the target state; the volumes say how many of each task type there are. Between them they size capacity by role in both states.",
  },
  {
    id: "roleCapacity",
    label: "Role capacity",
    blurb:
      "Working hours and utilisation for each role the study names, and which assignment is the to-be state. Neither figure is in the files, so both start at the documented default.",
  },
  {
    id: "phasing",
    label: "Costs & phasing",
    blurb:
      "Which implementation costs the case carries, and how exits are spread across the phases after the notice period.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

const text = (value: string): AnswerStatus => (value.trim() === "" ? "empty" : "answered");

/** A numeric global that has a documented default: answered once it differs from it. */
const withDefault = (current: number, fallback: number): AnswerStatus =>
  current === fallback ? "default" : "answered";

const frontLineRoles = (c: Case) => c.roles.filter((r) => r.tier === "front-line");
const managerRoles = (c: Case) => c.roles.filter((r) => r.tier === "manager");

/**
 * Every unit carries a real number for every one of these roles.
 *
 * All rows, not any row: a register where nine of ten teams have a cost is exactly
 * the case that produces a confident blended figure covering 90% of the population.
 * G21 makes the same situation an export blocker, so the form should not call it
 * answered.
 */
const everyUnitHasRoleValue = (
  c: Case,
  roleIds: string[],
  field: "headcount" | "cost",
): AnswerStatus => {
  if (c.units.length === 0 || roleIds.length === 0) return "empty";
  for (const u of c.units) {
    for (const id of roleIds) {
      if (typeof u[field][id] !== "number") return "empty";
    }
  }
  return "answered";
};

const anyUnitHasRoleValue = (c: Case, roleIds: string[], field: "headcount" | "cost"): AnswerStatus => {
  for (const u of c.units) {
    for (const id of roleIds) if (typeof u[field][id] === "number") return "answered";
  }
  return "empty";
};

/* -------------------------------------------------------------------------- */
/* The 35 questions                                                           */
/* -------------------------------------------------------------------------- */

export const QUESTIONS: readonly Question[] = [
  /* ---- Batch 1: Company & initiative (Q1–Q5) ---- */
  { id: "Q1", batch: "company", label: "Company name", required: true, status: (c) => text(c.meta.company) },
  { id: "Q2", batch: "company", label: "Industry / sector", required: true, status: (c) => text(c.meta.industry) },
  { id: "Q3", batch: "company", label: "Core problem being solved", required: false, status: (c) => text(c.meta.coreProblem) },
  { id: "Q4", batch: "company", label: "Initiative title", required: true, status: (c) => text(c.meta.initiativeTitle) },
  { id: "Q5", batch: "company", label: "Prepared by and model date", required: false, status: (c) => text(c.meta.preparedBy) },

  /* ---- Batch 2: Scope & regions (Q6–Q8) ---- */
  { id: "Q6", batch: "scope", label: "Regions in scope", required: true, status: (c) => (c.units.length === 0 ? "empty" : "answered"), models: REDUCTION_ONLY },
  {
    id: "Q7",
    models: REDUCTION_ONLY,
    batch: "scope",
    label: "Working hours per year",
    required: false,
    status: (c) =>
      c.units.some((u) => typeof u.workingHoursPerYear === "number")
        ? "answered"
        : withDefault(c.globals.workingHoursPerYear, 1880),
  },
  {
    id: "Q8",
    models: REDUCTION_ONLY,
    batch: "scope",
    label: "Utilisation %",
    required: false,
    status: (c) =>
      c.units.some((u) => typeof u.utilisationPct === "number")
        ? "answered"
        : withDefault(c.globals.utilisationPct, 0.75),
  },

  /* ---- Batch 3: Roles & span (Q9, Q10, Q13, Q14) ---- */
  {
    id: "Q9",
    batch: "roles",
    label: "Front-line role title",
    required: true,
    status: (c) => (frontLineRoles(c).some((r) => r.title.trim() !== "") ? "answered" : "empty"),
  },
  {
    id: "Q10",
    batch: "roles",
    label: "Manager role title",
    required: false,
    status: (c) => (managerRoles(c).some((r) => r.title.trim() !== "") ? "answered" : "empty"),
  },
  { id: "Q13", batch: "roles", label: "Target span of control", required: false, status: (c) => withDefault(c.globals.spanOfControl, 8) },
  {
    id: "Q14",
    batch: "roles",
    label: "Additional role tiers",
    required: false,
    status: (c) => (c.roles.length > 2 ? "answered" : "empty"),
  },

  /* ---- Batch 4: Units & headcount (Q11, Q12) ---- */
  {
    id: "Q11",
    models: REDUCTION_ONLY,
    batch: "units",
    label: "Front-line FTE per row",
    required: true,
    status: (c) => everyUnitHasRoleValue(c, frontLineRoles(c).map((r) => r.id), "headcount"),
  },
  {
    id: "Q12",
    models: REDUCTION_ONLY,
    batch: "units",
    label: "Manager FTE per row",
    required: false,
    status: (c) =>
      managerRoles(c).length === 0
        ? "n/a"
        : anyUnitHasRoleValue(c, managerRoles(c).map((r) => r.id), "headcount"),
  },

  /* ---- Batch 5: Compensation (Q15, Q16) ---- */
  {
    id: "Q15",
    models: REDUCTION_ONLY,
    batch: "compensation",
    label: "All-in cost per front-line FTE",
    required: true,
    status: (c) => everyUnitHasRoleValue(c, frontLineRoles(c).map((r) => r.id), "cost"),
  },
  {
    id: "Q16",
    models: REDUCTION_ONLY,
    batch: "compensation",
    label: "All-in cost per manager FTE",
    required: false,
    status: (c) =>
      managerRoles(c).length === 0
        ? "n/a"
        : anyUnitHasRoleValue(c, managerRoles(c).map((r) => r.id), "cost"),
  },

  /* ---- Batch 6: Workload & demand (Q17–Q20, Q22) ---- */
  { id: "Q17", batch: "workload", label: "Workload unit name", required: true, status: (c) => text(c.meta.workloadUnitName) },
  {
    id: "Q18",
    models: REDUCTION_ONLY,
    batch: "workload",
    label: "Annual volume per row",
    required: true,
    status: (c) => {
      if (c.units.length === 0) return "empty";
      return c.units.every((u) => typeof u.volume === "number") ? "answered" : "empty";
    },
  },
  { id: "Q19", batch: "workload", label: "Handle time source", required: false, status: (c) => (c.globals.handleTimeSource === "Manual" ? "default" : "answered"), models: REDUCTION_ONLY },
  {
    id: "Q20",
    models: REDUCTION_ONLY,
    batch: "workload",
    label: "Average handle time (minutes)",
    required: true,
    // Satisfied by a Time Study too — the study is the more defensible answer, and
    // requiring the manual figure as well would be busywork.
    status: (c) => {
      if (c.globals.handleTimeMinutes > 0) return "answered";
      if (c.globals.handleTimeSource === "Time Study" && !Number.isNaN(weightedAverageHandleTime(c.timeStudy))) {
        return "answered";
      }
      return "empty";
    },
  },
  { id: "Q22", batch: "workload", label: "Volume uplift % over the horizon", required: false, status: (c) => withDefault(c.globals.upliftPct, 0), models: REDUCTION_ONLY },

  /* ---- Batch 7: Time study (Q21) ---- */
  {
    id: "Q21",
    batch: "timeStudy",
    label: "Task types, times and volumes",
    required: false,
    status: (c) => {
      if (c.globals.handleTimeSource === "Manual") return "n/a";
      return Number.isNaN(weightedAverageHandleTime(c.timeStudy)) ? "empty" : "answered";
    },
  },

  /* ---- Batch 8: Scenarios & severance (Q23–Q28) ---- */
  // The skill gives these as examples, not defaults, so an untouched zero is empty
  // rather than a default being held. See SUGGESTED_SCENARIOS.
  { id: "Q23", batch: "scenarios", label: "HC reduction % — Low", required: false, status: (c) => (c.scenarios.low.hcReductionPct > 0 ? "answered" : "empty"), models: REDUCTION_ONLY },
  { id: "Q24", batch: "scenarios", label: "HC reduction % — Base", required: true, status: (c) => (c.scenarios.base.hcReductionPct > 0 ? "answered" : "empty"), models: REDUCTION_ONLY },
  { id: "Q25", batch: "scenarios", label: "HC reduction % — High", required: false, status: (c) => (c.scenarios.high.hcReductionPct > 0 ? "answered" : "empty"), models: REDUCTION_ONLY },
  {
    id: "Q26",
    batch: "scenarios",
    label: "Severance weeks per FTE",
    required: false,
    status: (c) => (c.globals.implementationCosts === "None" ? "n/a" : withDefault(c.globals.severanceWeeks, 8)),
  },
  {
    id: "Q27",
    batch: "scenarios",
    label: "Severance timing",
    required: false,
    status: (c) =>
      c.globals.implementationCosts === "None"
        ? "n/a"
        : c.globals.severanceTiming === "Lump sum at exit"
          ? "default"
          : "answered",
  },
  { id: "Q28", batch: "scenarios", label: "Time horizon (years)", required: false, status: (c) => withDefault(c.globals.horizonYears, 3) },

  /* ---- Batch 9: Costs & phasing (Q29–Q35) ---- */
  {
    id: "Q29",
    batch: "phasing",
    label: "Implementation costs to model",
    required: false,
    status: (c) => (c.globals.implementationCosts === "Severance + consulting" ? "default" : "answered"),
  },
  {
    id: "Q30",
    batch: "phasing",
    label: "Consulting / transition cost",
    required: false,
    status: (c) =>
      c.globals.implementationCosts === "Severance + consulting"
        ? c.globals.consultingCost > 0
          ? "answered"
          : "empty"
        : "n/a",
  },
  { id: "Q31", batch: "phasing", label: "Notice period (months)", required: false, status: (c) => withDefault(c.globals.noticeMonths, 2) },
  { id: "Q32", batch: "phasing", label: "Number of exit phases", required: false, status: (c) => withDefault(c.globals.phaseCount, 4) },
  { id: "Q33", batch: "phasing", label: "Months per phase", required: false, status: (c) => withDefault(c.globals.monthsPerPhase, 3) },
  { id: "Q34", batch: "phasing", label: "Exit profile", required: false, status: (c) => (c.globals.exitProfile === "Front-loaded" ? "default" : "answered") },
  {
    id: "Q35",
    batch: "phasing",
    label: "Phase weight table",
    required: false,
    status: (c) => {
      const weights = c.globals.phaseWeights[c.globals.exitProfile] ?? [];
      return Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-9 ? "default" : "answered";
    },
  },
  /* ---- Capacity model: additions beyond the skill's 35 ---- */
  {
    id: "C1",
    models: CAPACITY_ONLY,
    batch: "capacityUpload",
    label: "Time study",
    // The capacity model cannot produce a single number without it, so it blocks.
    required: true,
    status: (c) => ((c.capacity?.rows.length ?? 0) > 0 ? "answered" : "empty"),
  },
  {
    id: "C2",
    models: CAPACITY_ONLY,
    batch: "capacityUpload",
    label: "Volumes study",
    required: true,
    status: (c) => ((c.capacity?.demand.length ?? 0) > 0 ? "answered" : "empty"),
  },
  {
    id: "C3",
    batch: "roleCapacity",
    label: "Working hours and utilisation per role",
    required: false,
    status: (c) => {
      const staffed = (c.capacity?.roles ?? []).filter((r) => !r.automated && !r.unassigned);
      if (staffed.length === 0) return "n/a";
      if (staffed.some((r) => !(r.workingHoursPerYear > 0) || !(r.utilisationPct > 0))) return "empty";
      // Every staffed role still sitting on both documented defaults means nobody has
      // confirmed them, which is a different statement from having entered them.
      const untouched = staffed.every(
        (r) => r.workingHoursPerYear === 1880 && r.utilisationPct === 0.75,
      );
      return untouched ? "default" : "answered";
    },
  },
  {
    id: "C4",
    batch: "roleCapacity",
    label: "To-be role assignment",
    required: false,
    status: (c) => {
      const capacity = c.capacity;
      if (!capacity || capacity.roleColumns.length === 0) return "n/a";
      // Same column for both means no reallocation is being modelled yet.
      return capacity.targetColumn === capacity.baseColumn ? "empty" : "answered";
    },
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Readiness                                                                  */
/* -------------------------------------------------------------------------- */

export interface BatchProgress {
  batch: Batch;
  questions: Array<{ question: Question; status: AnswerStatus }>;
  answered: number;
  /** Questions that count toward progress — "n/a" ones do not. */
  applicable: number;
  /** Required questions still empty. */
  blocking: Question[];
  /** Whether this batch could be marked not-applicable. */
  skippable: boolean;
  /** Whether the user has marked it not-applicable. */
  skipped: boolean;
}

export const batchProgress = (
  c: Case,
  skipped: ReadonlySet<BatchId> = new Set(),
): BatchProgress[] =>
  BATCHES.map((batch) => {
    const questions = QUESTIONS.filter((q) => q.batch === batch.id).map((question) => ({
      question,
      // A question outside the active model is not unanswered, it is not asked.
      status: appliesToModel(question, c) ? question.status(c) : ("n/a" as AnswerStatus),
    }));
    const isSkipped = skipped.has(batch.id);
    // A skipped batch contributes nothing to the denominator, so the progress figure
    // reads against what the user has actually taken on rather than against every
    // question the interview could ask.
    const applicable = isSkipped ? [] : questions.filter((q) => q.status !== "n/a");
    return {
      batch,
      questions,
      answered: applicable.filter((q) => q.status === "answered").length,
      applicable: applicable.length,
      blocking: applicable
        .filter((q) => q.question.required && q.status === "empty")
        .map((q) => q.question),
      skippable: isSkippable(c, batch.id),
      skipped: isSkipped,
    };
  });

export interface Readiness {
  /** Every required question answered. */
  canGenerate: boolean;
  batches: BatchProgress[];
  /** Required questions still outstanding, across all batches. */
  blocking: Question[];
  answered: number;
  applicable: number;
}

export const readiness = (
  c: Case,
  skipped: ReadonlySet<BatchId> = new Set(),
): Readiness => {
  const batches = batchProgress(c, skipped);
  const blocking = batches.flatMap((b) => b.blocking);
  return {
    canGenerate: blocking.length === 0,
    batches,
    blocking,
    answered: batches.reduce((a, b) => a + b.answered, 0),
    applicable: batches.reduce((a, b) => a + b.applicable, 0),
  };
};

/** Flat question-id -> status lookup, derived from an already-computed readiness. */
export const statusMapOf = (r: Readiness): Record<string, AnswerStatus> =>
  Object.fromEntries(
    r.batches.flatMap((b) => b.questions.map((q) => [q.question.id, q.status] as const)),
  );

/** Units whose volume is still unanswered, for the coverage note on the output. */
export const unitsWithoutVolume = (c: Case): string[] =>
  c.units.filter((u) => u.volume === SENTINEL).map((u) => u.name || u.id);
