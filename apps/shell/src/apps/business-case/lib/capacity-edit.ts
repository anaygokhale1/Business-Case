/**
 * Editing the capacity study by hand.
 *
 * The uploads and the form write the same document, so a case can be typed, imported, or
 * imported and then corrected. Everything here is pure and total: given a block it returns
 * a block, and it never reaches for a clock or a random number so a reducer sequence
 * replays identically in a test.
 *
 * Three invariants have to be maintained on every edit, because breaking any of them
 * produces a study that computes cleanly and answers a different question.
 *
 * **Roles follow the rows.** A role typed into a cell needs capacity parameters before it
 * can be sized, and a role no longer named by any row should stop appearing. `buildRoleParams`
 * keeps parameters the user already entered, so correcting a typo in a task does not reset
 * the hours and utilisation of the role it belongs to.
 *
 * **Every task type used by a row needs a demand cell.** Otherwise the type is measured and
 * unvolumed, the tasks contribute nothing, and the answer is complete-looking and too low.
 * A cell is created the moment a type is named, holding a known-missing volume rather than
 * a zero — a zero would claim the type genuinely has no work.
 *
 * **A row with no task type must reach no demand.** In the engine an empty
 * `transactionTypes` means "applies to every type", so a half-typed row would silently pick
 * up the whole book. The type is therefore always stored as a single entry, blank included:
 * `[""]` matches no demand cell, because a demand cell always names a real type.
 */

import { buildRoleParams } from "./capacity-populate";
import { uniqueId } from "./case-reducer";
import { distinctRoles, normaliseRole } from "./engine/process-study";
import type { CapacityBlock, DemandCell, Driver, ProcessRow } from "./engine/types";
import { SENTINEL } from "./engine/types";
import { SIMPLE_LOB, SIMPLE_ROLE_COLUMNS } from "./import/simple-capacity";

/** The fields the task grid edits. Everything else on a row is structural. */
export interface TaskPatch {
  task?: string;
  taskType?: string;
  currentRole?: string;
  targetRole?: string;
  ahtMinutes?: Driver | null;
}

/** An empty block, for a case that starts by typing rather than uploading. */
export const emptyCapacityBlock = (): CapacityBlock => ({
  rows: [],
  demand: [],
  statusShares: {},
  roles: [],
  roleColumns: [...SIMPLE_ROLE_COLUMNS],
  baseColumn: "current",
  targetColumn: "target",
  excludedRowIds: [],
  redeploymentRate: 0,
  recruitmentCostPct: 0,
  currency: "USD",
});

/**
 * A blank task row.
 *
 * The handling time starts known-missing rather than at zero: a row nobody has answered
 * contributes nothing and is reported as incomplete, where a zero would assert the task
 * takes no time and quietly reduce the requirement.
 */
export const blankTaskRow = (id: string): ProcessRow => ({
  id,
  path: [""],
  lob: SIMPLE_LOB,
  region: "",
  transactionTypes: [""],
  statuses: [],
  roles: {},
  ahtMinutes: SENTINEL,
  frequency: 1,
});

/** Read the grid's view of a row. */
export const taskOf = (row: ProcessRow): string => row.path[row.path.length - 1] ?? "";
export const typeOf = (row: ProcessRow): string => row.transactionTypes[0] ?? "";
export const roleOf = (row: ProcessRow, column: string): string => row.roles[column] ?? "";

const withoutBlanks = (values: string[]) => values.filter((v) => v !== "");

/**
 * Bring `roles` and `demand` back in line with `rows`.
 *
 * Run after any row edit. Volumes already entered survive, and so do role parameters — the
 * point of re-deriving rather than mutating is that a rename cannot leave an orphan behind
 * that still contributes to a total.
 */
export const syncCapacity = (block: CapacityBlock): CapacityBlock => {
  const named = withoutBlanks(distinctRoles(block.rows, block.roleColumns));
  const roles = buildRoleParams(named, block.roles);

  const usedTypes = withoutBlanks(block.rows.map(typeOf));
  const seen = new Set<string>();
  const orderedTypes: string[] = [];
  for (const type of usedTypes) {
    if (seen.has(type)) continue;
    seen.add(type);
    orderedTypes.push(type);
  }

  const byType = new Map(block.demand.map((cell) => [cell.transactionType, cell]));
  const demand: DemandCell[] = orderedTypes.map(
    (type) =>
      byType.get(type) ?? {
        lob: SIMPLE_LOB,
        transactionType: type,
        // Known-missing, not zero. A type named but not yet counted has an unknown
        // volume, and a zero would claim it has no work at all.
        submissions: SENTINEL,
      },
  );

  // A cell whose type no longer appears in any row is kept, so deleting a task by mistake
  // does not throw away a volume that was typed in. `reconcileTaskTypes` names it.
  for (const cell of block.demand) {
    if (!seen.has(cell.transactionType)) demand.push(cell);
  }

  return { ...block, roles, demand };
};

/** Append a blank row, initialising the block if the case has none. */
export const addTask = (block: CapacityBlock | undefined): CapacityBlock => {
  const base = block ?? emptyCapacityBlock();
  const id = uniqueId(
    "task",
    base.rows.map((r) => r.id),
  );
  return syncCapacity({ ...base, rows: [...base.rows, blankTaskRow(id)] });
};

/**
 * Apply a patch to one row.
 *
 * Other rows are returned by reference. The engine memoises nothing per process row today,
 * but the reducer's contract is that an edit to one thing leaves the rest identical, and a
 * grid that rebuilt every row on each keystroke would make that untrue everywhere it is
 * relied on later.
 */
export const setTask = (
  block: CapacityBlock,
  rowId: string,
  patch: TaskPatch,
): CapacityBlock => {
  let hit = false;
  const rows = block.rows.map((row) => {
    if (row.id !== rowId) return row;
    hit = true;
    return applyTaskPatch(row, patch);
  });
  return hit ? syncCapacity({ ...block, rows }) : block;
};

const applyTaskPatch = (row: ProcessRow, patch: TaskPatch): ProcessRow => {
  const next: ProcessRow = { ...row, roles: { ...row.roles } };

  if (patch.task !== undefined) {
    // The path is the taxonomy in a detailed study. Editing by hand replaces only its
    // last level, so a row imported with a deeper path keeps the levels above it.
    next.path = [...row.path.slice(0, -1), patch.task];
    if (next.path.length === 0) next.path = [patch.task];
  }

  if (patch.taskType !== undefined) next.transactionTypes = [patch.taskType];

  for (const [field, column] of [
    ["currentRole", "current"],
    ["targetRole", "target"],
  ] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    const role = normaliseRole(value);
    // Deleted rather than set to "": an absent target is what makes the engine carry the
    // current owner forward, so a task the user clears goes back to "unchanged" instead of
    // becoming work that reaches nobody.
    if (role === "") delete next.roles[column];
    else next.roles[column] = role;
  }

  if (patch.ahtMinutes !== undefined) {
    next.ahtMinutes = patch.ahtMinutes === null ? SENTINEL : patch.ahtMinutes;
  }

  return next;
};

/** Drop a row, and any exclusion decision that referred to it. */
export const removeTask = (block: CapacityBlock, rowId: string): CapacityBlock =>
  syncCapacity({
    ...block,
    rows: block.rows.filter((r) => r.id !== rowId),
    excludedRowIds: block.excludedRowIds.filter((id) => id !== rowId),
  });

/**
 * Set the volume of one task type.
 *
 * Volume belongs to the type, not the task: several tasks share a type and there is one
 * count of transactions behind all of them. Editing it on any row of the type therefore
 * edits the same figure, which is also why the grid shows it once per type rather than
 * once per row.
 */
export const setTypeVolume = (
  block: CapacityBlock,
  taskType: string,
  volume: number | null,
): CapacityBlock => {
  if (taskType === "") return block;

  const value: Driver = volume === null ? SENTINEL : volume;
  let hit = false;
  const demand = block.demand.map((cell) => {
    if (cell.transactionType !== taskType) return cell;
    hit = true;
    return { ...cell, submissions: value };
  });

  if (hit) return { ...block, demand };
  return { ...block, demand: [...demand, { lob: SIMPLE_LOB, transactionType: taskType, submissions: value }] };
};

/** The volume against a task type, or null when it has none yet. */
export const volumeOfType = (block: CapacityBlock, taskType: string): number | null => {
  const cell = block.demand.find((c) => c.transactionType === taskType);
  return cell && typeof cell.submissions === "number" ? cell.submissions : null;
};

/**
 * Rows in the order the grid shows them: grouped by task type, types in first-seen order.
 *
 * Grouping matters for more than tidiness — the volume column is shown once per type, on
 * that type's first row, and a scattered order would put the same figure in several places
 * down the table.
 */
export const groupedTasks = (
  block: CapacityBlock,
): Array<{ taskType: string; rows: ProcessRow[] }> => {
  const order: string[] = [];
  const byType = new Map<string, ProcessRow[]>();
  for (const row of block.rows) {
    const type = typeOf(row);
    if (!byType.has(type)) {
      byType.set(type, []);
      order.push(type);
    }
    byType.get(type)!.push(row);
  }
  return order.map((taskType) => ({ taskType, rows: byType.get(taskType)! }));
};
