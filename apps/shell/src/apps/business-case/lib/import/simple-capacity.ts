/**
 * The simple two-file capacity format.
 *
 * A time study of five columns:
 *
 *   Task / Action | Task Type | Current Role | Target Role | Average Handling Time
 *
 * and a volumes sheet keyed on the same Task Type. Between them that is a complete
 * capacity model: the study says how long each task takes and who does it now and in the
 * target state, the volumes say how many of each type there are, and required FTE per role
 * follows in both states.
 *
 * These emit exactly the same `StudyImportResult` and `DemandCell[]` the wide process-study
 * importer does, so the engine, the guardrails, the role parameters and the valuation are
 * the ones already in place. Task Type maps to the transaction-type dimension, the two role
 * columns to `current` and `target`, and everything is filed under a single line of business
 * — a simple study has no line-of-business split, and inventing one would put a dimension in
 * the model that the client never measured.
 *
 * Two things here are not obvious and both cost real accuracy if got wrong.
 *
 * **A blank Target Role means the work stays where it is, not that it goes nowhere.** The
 * engine already carries the current owner forward for an unassigned target (G30), so a
 * study that only names the roles that move is read correctly rather than showing every
 * unchanged task as lost work.
 *
 * **A volume column in a row-per-task file repeats.** If the volumes sheet also carries
 * roles and handle times then it has one row per task, and the volume against each row is
 * the count for its Task Type, stated again on every row of that type. Adding those up
 * multiplies demand by the number of tasks. Which reading applies is inferred from the
 * shape of the file and then shown as a control, because the file cannot be trusted to
 * say and the error is invisible in the result.
 */

import type { DemandCell, ProcessRow } from "../engine/types";
import { MISSING } from "../engine/alg";
import { normaliseRole } from "../engine/process-study";
import { assignColumns, normaliseHeader, scoreAgainstAliases } from "./headers";
import { parseCellNumber } from "./numbers";
import type { Sheet } from "./tabular";
import type { StudyImportResult, StudyRowIssue } from "./process-study-map";

/**
 * The single line of business every simple row and demand cell is filed under.
 *
 * Shared by both importers because `computeCapacity` matches rows to demand on it: two
 * different spellings here would produce a study and a volume sheet that never meet, and
 * the result would be a clean zero rather than an error.
 */
export const SIMPLE_LOB = "All work";

/** The as-is and to-be role columns the simple format produces. */
export const SIMPLE_ROLE_COLUMNS = ["current", "target"] as const;

/* -------------------------------------------------------------------------- */
/* Time study                                                                 */
/* -------------------------------------------------------------------------- */

export type SimpleStudyField = "task" | "taskType" | "currentRole" | "targetRole" | "ahtMinutes";

export type SimpleStudyMapping = Record<SimpleStudyField, number | null>;

export const SIMPLE_STUDY_FIELDS: readonly SimpleStudyField[] = [
  "task",
  "taskType",
  "currentRole",
  "targetRole",
  "ahtMinutes",
] as const;

export const SIMPLE_STUDY_LABEL: Record<SimpleStudyField, string> = {
  task: "Task / action",
  taskType: "Task type",
  currentRole: "Current role",
  targetRole: "Target role",
  ahtMinutes: "Average handling time",
};

const STUDY_ALIASES: Record<SimpleStudyField, readonly string[]> = {
  task: ["taskaction", "task", "action", "activity", "step", "taskname", "description", "process"],
  taskType: ["tasktype", "type", "transactiontype", "worktype", "category", "transaction"],
  currentRole: [
    "currentrole",
    "asisrole",
    "existingrole",
    "currentowner",
    "performedby",
    "current",
    "asis",
    "owner",
    "role",
  ],
  targetRole: [
    "targetrole",
    "proposedrole",
    "futurerole",
    "toberole",
    "target",
    "proposed",
    "future",
    "tobe",
  ],
  ahtMinutes: [
    "averagehandlingtime",
    "averagehandletime",
    "avghandlingtime",
    "handlingtime",
    "handletime",
    "aht",
    "minutespertask",
    "minutes",
  ],
};

const bestScore = <F extends string>(cell: string, aliases: Record<F, readonly string[]>, fields: readonly F[]) =>
  Math.max(0, ...fields.map((f) => scoreAgainstAliases(cell, aliases[f])));

/** Score each of the first rows against the simple-study vocabulary and take the best. */
export const detectSimpleStudyHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let best = -1;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const score = rows[i]!.reduce(
      (total, cell) => total + bestScore(cell, STUDY_ALIASES, SIMPLE_STUDY_FIELDS),
      0,
    );
    if (score > best) {
      best = score;
      bestRow = i;
    }
  }
  return bestRow;
};

export const proposeSimpleStudyMapping = (header: string[]): SimpleStudyMapping =>
  assignColumns(header, STUDY_ALIASES, SIMPLE_STUDY_FIELDS);

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === "");

const at = (row: string[], column: number | null) => (column === null ? "" : (row[column] ?? ""));

/** Stable, deterministic row id from what the row is, not from where it sits in the file. */
const rowId = (taskType: string, task: string, taken: Set<string>): string => {
  const stem =
    `${normaliseHeader(taskType)}-${normaliseHeader(task)}`.replace(/^-+|-+$/g, "") || "task";
  if (!taken.has(stem)) {
    taken.add(stem);
    return stem;
  }
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n += 1;
  const id = `${stem}-${n}`;
  taken.add(id);
  return id;
};

export const convertSimpleStudyRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: SimpleStudyMapping,
): StudyImportResult => {
  const rows: ProcessRow[] = [];
  const issues: StudyRowIssue[] = [];
  const taken = new Set<string>();
  const taskTypes: string[] = [];
  const roles: string[] = [];
  let considered = 0;

  /** Signature -> first sheet row, for spotting a repeated measurement. */
  const seen = new Map<string, number>();

  const noteRole = (role: string) => {
    if (role !== "" && !roles.includes(role)) roles.push(role);
  };

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const raw = sheet.rows[i]!;
    if (isBlank(raw)) continue;
    considered += 1;
    const sheetRow = i + 1;

    const taskType = at(raw, mapping.taskType).trim();
    // The task name is the row's label, not a driver. With no name the task type is a
    // better label than a blank cell, and the row still computes.
    const task = at(raw, mapping.task).trim() || taskType;
    const currentRole = normaliseRole(at(raw, mapping.currentRole));
    const targetRole = normaliseRole(at(raw, mapping.targetRole));

    if (taskType === "") {
      issues.push({
        sheetRow,
        // Without a type the row joins no volume, so it would contribute nothing while
        // still appearing to have imported.
        message: `skipped — "${task || "unnamed task"}" has no task type, so no volume can reach it`,
        dropped: true,
      });
      continue;
    }

    const aht = parseCellNumber(at(raw, mapping.ahtMinutes), { grouping: "decimal" });
    if (aht.value === null) {
      issues.push({
        sheetRow,
        message: `skipped — ${task} has no readable handling time`,
        dropped: true,
      });
      continue;
    }
    if (aht.value < 0) {
      issues.push({
        sheetRow,
        message: `skipped — ${task} has a negative handling time (${aht.value})`,
        dropped: true,
      });
      continue;
    }
    if (aht.note) issues.push({ sheetRow, message: `${task}: ${aht.note}`, dropped: false });

    if (currentRole === "" && targetRole === "") {
      issues.push({
        sheetRow,
        message: `skipped — ${task} names neither a current nor a target role, so its minutes reach nobody`,
        dropped: true,
      });
      continue;
    }

    if (aht.value === 0) {
      issues.push({
        sheetRow,
        // Legal — a task can be measured at zero — but it contributes no capacity, and a
        // column of zeros usually means the study was not filled in.
        message: `${task} is measured at zero minutes and adds no capacity`,
        dropped: false,
      });
    }

    if (currentRole === "" && targetRole !== "") {
      issues.push({
        sheetRow,
        // The current state is the baseline the whole comparison is measured from, so an
        // unowned task today understates the as-is requirement rather than the target.
        message: `${task} has a target role but no current role, so its minutes are missing from the current state`,
        dropped: false,
      });
    }

    const signature = [
      normaliseHeader(taskType),
      normaliseHeader(task),
      currentRole.toLowerCase(),
      targetRole.toLowerCase(),
      aht.value,
    ].join("|");
    const first = seen.get(signature);
    if (first !== undefined) {
      issues.push({
        sheetRow,
        // Both are kept: two teams doing the same task for the same volume is real. But
        // so is a copy-pasted row, and that doubles the task's minutes invisibly.
        message: `identical to row ${first} — ${task} is measured twice at ${aht.value} min and both are counted`,
        dropped: false,
      });
    } else {
      seen.set(signature, sheetRow);
    }

    const roleMap: Record<string, string> = {};
    if (currentRole !== "") roleMap["current"] = currentRole;
    // Left out when blank rather than set to "": an absent target is what makes the
    // engine carry the current owner forward instead of reading the task as lost.
    if (targetRole !== "") roleMap["target"] = targetRole;

    noteRole(currentRole);
    noteRole(targetRole);
    if (!taskTypes.includes(taskType)) taskTypes.push(taskType);

    rows.push({
      id: rowId(taskType, task, taken),
      path: [task],
      lob: SIMPLE_LOB,
      region: "",
      transactionTypes: [taskType],
      // No status dimension in this format. Empty means the task applies to every
      // transaction of its type, which is what the engine reads it as.
      statuses: [],
      roles: roleMap,
      ahtMinutes: aht.value,
      // One occurrence per transaction. The simple format has no frequency column, and
      // defaulting to 1 is the only reading that does not silently scale the study.
      frequency: 1,
    });
  }

  return {
    rows,
    issues,
    considered,
    discovered: {
      lobs: rows.length > 0 ? [SIMPLE_LOB] : [],
      regions: [],
      transactionTypes: taskTypes,
      statuses: [],
      roleColumns: [...SIMPLE_ROLE_COLUMNS],
      roles,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Volumes                                                                    */
/* -------------------------------------------------------------------------- */

export type SimpleVolumeField =
  | "taskType"
  | "volume"
  | "currentRole"
  | "targetRole"
  | "ahtMinutes";

export type SimpleVolumeMapping = Record<SimpleVolumeField, number | null>;

export const SIMPLE_VOLUME_FIELDS: readonly SimpleVolumeField[] = [
  "taskType",
  "volume",
  "currentRole",
  "targetRole",
  "ahtMinutes",
] as const;

export const SIMPLE_VOLUME_LABEL: Record<SimpleVolumeField, string> = {
  taskType: "Task type",
  volume: "Volume",
  currentRole: "Current role",
  targetRole: "Target role",
  ahtMinutes: "Average handling time",
};

const VOLUME_ALIASES: Record<SimpleVolumeField, readonly string[]> = {
  taskType: STUDY_ALIASES.taskType,
  volume: [
    "annualvolume",
    "volume",
    "transactionsreceived",
    "transactions",
    "received",
    "count",
    "cases",
    "items",
    "quantity",
    "demand",
    "workload",
  ],
  currentRole: STUDY_ALIASES.currentRole,
  targetRole: STUDY_ALIASES.targetRole,
  ahtMinutes: STUDY_ALIASES.ahtMinutes,
};

/**
 * How to read several volume rows sharing one task type.
 *
 * `repeated` — the file has one row per task, and the volume against each is that type's
 * count stated again. Take it once.
 * `additive` — the file has one row per task type per slice (a month, a product), and the
 * counts add up.
 */
export type VolumeBasis = "repeated" | "additive";

export const detectSimpleVolumeHeaderRow = (rows: string[][]): number => {
  let bestRow = 0;
  let best = -1;
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const score = rows[i]!.reduce(
      (total, cell) => total + bestScore(cell, VOLUME_ALIASES, SIMPLE_VOLUME_FIELDS),
      0,
    );
    if (score > best) {
      best = score;
      bestRow = i;
    }
  }
  return bestRow;
};

export const proposeSimpleVolumeMapping = (header: string[]): SimpleVolumeMapping =>
  assignColumns(header, VOLUME_ALIASES, SIMPLE_VOLUME_FIELDS);

/**
 * The default reading for repeated task types, from the shape of the file.
 *
 * A file carrying roles or handle times has one row per task, so its volume column
 * repeats. A file of type and count alone has one row per type, so repeats add up.
 * Shown as a control either way — this is a default, not a determination.
 */
export const defaultVolumeBasis = (mapping: SimpleVolumeMapping): VolumeBasis =>
  mapping.currentRole !== null || mapping.targetRole !== null || mapping.ahtMinutes !== null
    ? "repeated"
    : "additive";

export interface SimpleVolumeResult {
  demand: DemandCell[];
  issues: StudyRowIssue[];
  considered: number;
  /** Task types found, in file order. */
  taskTypes: string[];
  /**
   * Study rows the volumes file could supply on its own, when it carries roles and
   * handle times. Only meaningful with no time study loaded — offered, never applied.
   */
  studyRows: StudyImportResult | null;
  basis: VolumeBasis;
}

export const convertSimpleVolumeRows = (
  sheet: Sheet,
  headerRow: number,
  mapping: SimpleVolumeMapping,
  basis: VolumeBasis,
): SimpleVolumeResult => {
  const issues: StudyRowIssue[] = [];
  const order: string[] = [];
  const groups = new Map<string, { taskType: string; values: Array<{ value: number; sheetRow: number }> }>();
  let considered = 0;

  for (let i = headerRow + 1; i < sheet.rows.length; i += 1) {
    const raw = sheet.rows[i]!;
    if (isBlank(raw)) continue;
    considered += 1;
    const sheetRow = i + 1;

    const taskType = at(raw, mapping.taskType).trim();
    if (taskType === "") {
      issues.push({ sheetRow, message: "skipped — no task type", dropped: true });
      continue;
    }

    const parsed = parseCellNumber(at(raw, mapping.volume), { grouping: "thousands" });
    if (parsed.value === null) {
      issues.push({ sheetRow, message: `skipped — ${taskType} has no readable volume`, dropped: true });
      continue;
    }
    if (parsed.value < 0) {
      issues.push({
        sheetRow,
        message: `skipped — ${taskType} has a negative volume (${parsed.value.toLocaleString("en-US")})`,
        dropped: true,
      });
      continue;
    }
    if (parsed.note) issues.push({ sheetRow, message: `${taskType}: ${parsed.note}`, dropped: false });

    const key = normaliseHeader(taskType);
    let group = groups.get(key);
    if (!group) {
      group = { taskType, values: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.values.push({ value: parsed.value, sheetRow });
  }

  const demand: DemandCell[] = [];
  const taskTypes: string[] = [];

  for (const key of order) {
    const group = groups.get(key)!;
    taskTypes.push(group.taskType);

    if (group.values.length === 1) {
      demand.push({ lob: SIMPLE_LOB, transactionType: group.taskType, submissions: group.values[0]!.value });
      continue;
    }

    const distinct = [...new Set(group.values.map((v) => v.value))];

    if (basis === "additive") {
      const total = group.values.reduce((t, v) => t + v.value, 0);
      issues.push({
        sheetRow: 0,
        message: `${group.taskType}: ${group.values.length} rows added together to ${total.toLocaleString("en-US")}. Switch to "stated once per type" if the same count is repeated on each row.`,
        dropped: false,
      });
      demand.push({ lob: SIMPLE_LOB, transactionType: group.taskType, submissions: total });
      continue;
    }

    // Repeated: the count belongs to the type and is restated per task.
    if (distinct.length === 1) {
      demand.push({ lob: SIMPLE_LOB, transactionType: group.taskType, submissions: distinct[0]! });
      continue;
    }

    // The rows disagree about a figure they are all supposed to be restating. Taking the
    // largest is the only choice that cannot understate demand, and it is reported.
    const chosen = Math.max(...distinct);
    issues.push({
      sheetRow: 0,
      message: `${group.taskType}: its rows state ${distinct
        .map((v) => v.toLocaleString("en-US"))
        .join(", ")} as the same volume. Using ${chosen.toLocaleString("en-US")} — check the extract.`,
      dropped: false,
    });
    demand.push({ lob: SIMPLE_LOB, transactionType: group.taskType, submissions: chosen });
  }

  // When the file carries roles and times it is a study in its own right, so it is
  // converted as one and offered. Nothing here applies it.
  const carriesStudy =
    mapping.ahtMinutes !== null && (mapping.currentRole !== null || mapping.targetRole !== null);
  const studyRows = carriesStudy
    ? convertSimpleStudyRows(sheet, headerRow, {
        // Task type doubles as the task name: a row-per-task volumes file has no separate
        // label column, and using the type keeps the rows identifiable.
        task: mapping.taskType,
        taskType: mapping.taskType,
        currentRole: mapping.currentRole,
        targetRole: mapping.targetRole,
        ahtMinutes: mapping.ahtMinutes,
      })
    : null;

  return { demand, issues, considered, taskTypes, studyRows, basis };
};

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Task types in the study with no volume, and volumes with no task.
 *
 * The first is the consequential one: those tasks contribute nothing, so the capacity
 * figure is complete-looking and too low. Neither is an error the files can detect on
 * their own — each is internally consistent — so it is checked at the join.
 */
export const reconcileTaskTypes = (
  rows: ProcessRow[],
  demand: DemandCell[],
): { withoutVolume: string[]; withoutTasks: string[] } => {
  const inStudy = new Map<string, string>();
  for (const row of rows) {
    for (const type of row.transactionTypes) {
      // A row typed into the form starts with no type. That is an unfinished row, not a
      // type awaiting a volume, and the grid flags it where the user can see it.
      if (type.trim() === "") continue;
      inStudy.set(normaliseHeader(type), type);
    }
  }
  const inVolumes = new Map<string, string>();
  for (const cell of demand) inVolumes.set(normaliseHeader(cell.transactionType), cell.transactionType);

  const withoutVolume: string[] = [];
  for (const [key, label] of inStudy) if (!inVolumes.has(key)) withoutVolume.push(label);

  const withoutTasks: string[] = [];
  for (const [key, label] of inVolumes) if (!inStudy.has(key)) withoutTasks.push(label);

  return { withoutVolume, withoutTasks };
};

/** Minutes per transaction of one task type, per role, for the drill-down. */
export const minutesByRole = (
  rows: ProcessRow[],
  column: string,
  fallbackColumn = "current",
): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const role = row.roles[column] ?? row.roles[fallbackColumn] ?? "";
    if (role === "") continue;
    const aht = typeof row.ahtMinutes === "number" ? row.ahtMinutes : MISSING;
    if (Number.isNaN(aht)) continue;
    totals.set(role, (totals.get(role) ?? 0) + aht);
  }
  return totals;
};
