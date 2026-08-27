"use client";

/**
 * The task table, typed by hand.
 *
 * One table behind both the Workload & demand step and the Time study step, showing
 * different columns of the same rows. That is deliberate: a task is one thing, and having
 * two grids that each owned part of it would let the two drift — a task named in one and
 * not the other, a role recorded twice with different spellings. The columns a step shows
 * are the columns that step is about; the row is shared.
 *
 * The same rows an upload produces, so a case can be typed, imported, or imported and then
 * corrected in place.
 *
 * **Volume sits on the task type, not the task.** Several tasks share a type and there is
 * one count of transactions behind all of them, so the volume cell spans its type's rows.
 * Repeating it per row would read as several independent counts, which is exactly the
 * mistake the upload's "stated once per type" control exists to prevent.
 */

import { useState } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import {
  groupedTasks,
  roleOf,
  taskOf,
  typeOf,
  volumeOfType,
  type TaskPatch,
} from "../../lib/capacity-edit";
import { isMissing } from "../../lib/engine/alg";
import type { ProcessRow } from "../../lib/engine/types";
import { count } from "../../lib/format";
import { ghostButtonClass, inputClass, numericInputClass, NumberInput, primaryButtonClass } from "./fields";

export type TaskColumn =
  | "task"
  | "taskType"
  | "currentRole"
  | "targetRole"
  | "aht"
  | "volume"
  | "minutes";

const HEADING: Record<TaskColumn, string> = {
  task: "Task / action",
  taskType: "Task type",
  currentRole: "Current role",
  targetRole: "Target role",
  aht: "Handling time (min)",
  volume: "Volume",
  minutes: "Minutes of work",
};

const NUMERIC: TaskColumn[] = ["aht", "volume", "minutes"];

/** Minutes of annual work one task creates: its handling time across its type's volume. */
const minutesOf = (row: ProcessRow, volume: number | null): number => {
  if (typeof row.ahtMinutes !== "number" || volume === null) return NaN;
  const frequency = typeof row.frequency === "number" ? row.frequency : 1;
  return row.ahtMinutes * frequency * volume;
};

export function TaskGrid({
  columns,
  addLabel,
  emptyMessage,
}: {
  columns: TaskColumn[];
  addLabel: string;
  emptyMessage: string;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const capacity = workingCase.capacity;
  const groups = capacity ? groupedTasks(capacity) : [];

  const add = (
    <button
      type="button"
      className={capacity && capacity.rows.length > 0 ? ghostButtonClass : primaryButtonClass}
      onClick={() => dispatch({ type: "capacity/addTask" })}
    >
      {addLabel}
    </button>
  );

  if (!capacity || capacity.rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">{emptyMessage}</div>
        {add}
      </div>
    );
  }

  // Known roles offered as suggestions. A role typed with a different spelling becomes a
  // separate role with its own defaults and takes part of the minutes with it, so the list
  // is worth more than it looks.
  const knownRoles = capacity.roles.map((r) => r.role);

  return (
    <div className="space-y-3">
      <datalist id="task-grid-roles">
        {knownRoles.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label="Task table">
          <thead>
            <tr className="text-left">
              {columns.map((column) => (
                <th
                  key={column}
                  className={`px-3 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${
                    NUMERIC.includes(column) ? "text-right" : ""
                  }`}
                >
                  {HEADING[column]}
                </th>
              ))}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.taskType || "(unassigned)"}>
              {group.rows.map((row, indexInGroup) => (
                <TaskRow
                  key={row.id}
                  row={row}
                  columns={columns}
                  volume={volumeOfType(capacity, group.taskType)}
                  /* The volume cell spans its type, so it is rendered on the first row only. */
                  spanRows={indexInGroup === 0 ? group.rows.length : 0}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {add}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TaskRow({
  row,
  columns,
  volume,
  spanRows,
}: {
  row: ProcessRow;
  columns: TaskColumn[];
  volume: number | null;
  spanRows: number;
}) {
  const { dispatch } = useCaseStore();
  const task = taskOf(row);
  const taskType = typeOf(row);
  const label = task || taskType || "this task";

  const patch = (p: TaskPatch) =>
    dispatch({ type: "capacity/setTask", rowId: row.id, patch: p });

  const cell = (column: TaskColumn) => {
    switch (column) {
      case "task":
        return (
          <TextCell
            ariaLabel={`Task for ${row.id}`}
            value={task}
            placeholder="Log the request"
            onCommit={(v) => patch({ task: v })}
          />
        );

      case "taskType":
        return (
          <div className="space-y-1">
            <TextCell
              ariaLabel={`Task type for ${row.id}`}
              value={taskType}
              placeholder="New"
              onCommit={(v) => patch({ taskType: v.trim() })}
            />
            {taskType.trim() === "" ? (
              // Said plainly, because the row looks finished otherwise: with no type there
              // is no volume to join to, so the task cannot contribute anything.
              <p className="text-[11px] font-semibold text-red-600">
                No task type, so no volume reaches this task
              </p>
            ) : null}
          </div>
        );

      case "currentRole":
      case "targetRole": {
        const column_ = column === "currentRole" ? "current" : "target";
        const value = roleOf(row, column_);
        return (
          <div className="space-y-1">
            <TextCell
              ariaLabel={`${column === "currentRole" ? "Current" : "Target"} role for ${row.id}`}
              value={value}
              placeholder={column === "currentRole" ? "Analyst" : "unchanged"}
              list="task-grid-roles"
              onCommit={(v) =>
                patch(column === "currentRole" ? { currentRole: v } : { targetRole: v })
              }
            />
            {column === "targetRole" && value === "" && roleOf(row, "current") !== "" ? (
              <p className="text-[11px] text-outline">
                Stays with {roleOf(row, "current")}
              </p>
            ) : null}
          </div>
        );
      }

      case "aht":
        return (
          <NumberInput
            ariaLabel={`Handling time for ${label}`}
            className={numericInputClass}
            value={typeof row.ahtMinutes === "number" ? row.ahtMinutes : null}
            // Cleared is known-missing, not zero: the task is reported as unmeasured
            // rather than asserted to take no time.
            onChange={(v) => patch({ ahtMinutes: v })}
            dp={2}
            placeholder="—"
          />
        );

      case "volume":
        return (
          <NumberInput
            ariaLabel={`Volume for ${taskType || row.id}`}
            className={numericInputClass}
            value={volume}
            onChange={(v) =>
              dispatch({ type: "capacity/setTypeVolume", taskType, volume: v })
            }
            dp={0}
            placeholder="—"
          />
        );

      case "minutes": {
        const minutes = minutesOf(row, volume);
        return (
          <span
            className="tabular-nums text-ink"
            title={
              isMissing(minutes)
                ? "Needs both a handling time and a volume for its task type"
                : `${row.ahtMinutes} min across ${count(volume ?? 0)} transactions`
            }
          >
            {isMissing(minutes) ? <span className="text-outline">n/a</span> : count(minutes)}
          </span>
        );
      }
    }
  };

  return (
    <tr className="border-t border-slate-100 align-top">
      {columns.map((column) => {
        // One volume per task type, so the cell spans the type's rows rather than being
        // repeated down them as if each task had its own count.
        if (column === "volume") {
          if (spanRows === 0) return null;
          return (
            <td
              key={column}
              rowSpan={spanRows}
              className="border-l border-slate-100 px-3 py-3 text-right align-middle"
            >
              {taskType.trim() === "" ? (
                <span className="text-xs text-outline">needs a type</span>
              ) : (
                cell(column)
              )}
            </td>
          );
        }
        return (
          <td
            key={column}
            className={`px-3 py-3 ${NUMERIC.includes(column) ? "text-right" : ""}`}
          >
            {cell(column)}
          </td>
        );
      })}
      <td className="px-3 py-3 text-right">
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() => dispatch({ type: "capacity/removeTask", rowId: row.id })}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A text cell that commits when it loses focus, not on every keystroke.
 *
 * Roles and task types are normalised on the way in — trailing spaces removed, runs of
 * whitespace collapsed — because a single trailing space makes a role a different role and
 * silently drops its minutes from the rollup. Normalising on each keystroke would delete
 * the space the moment it was typed, so a two-word role could never be entered at all.
 *
 * The draft-or-canonical pattern is the same one `NumberInput` uses, so an edit made
 * elsewhere still shows through once the field is not being typed in.
 */
function TextCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
  list,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  list?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <input
      type="text"
      className={inputClass}
      aria-label={ariaLabel}
      value={shown}
      placeholder={placeholder}
      {...(list ? { list } : {})}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
