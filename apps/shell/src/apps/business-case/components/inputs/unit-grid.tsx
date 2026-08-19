"use client";

/**
 * The register editor, shared by the three batches that edit per-row figures.
 *
 * Headcount, compensation and volume are three different questions in the interview
 * but the same table of rows, so they share one grid with different columns rather
 * than three near-identical tables that would drift apart.
 */

import type { ReactNode } from "react";

import { useCaseStore } from "../../hooks/use-case-store";
import { regionsOf } from "../../lib/case-reducer";
import type { Unit } from "../../lib/engine/types";
import { ghostButtonClass, inputClass } from "./fields";

export interface UnitColumn {
  key: string;
  label: string;
  /** The skill's question number, shown small next to the header. */
  questionId?: string;
  render: (unit: Unit) => ReactNode;
  align?: "left" | "right";
  /** Fixed width class, so numeric columns do not jump as values are typed. */
  width?: string;
}

export function UnitGrid({
  columns,
  emptyMessage,
  showAddRow = false,
}: {
  columns: UnitColumn[];
  emptyMessage: ReactNode;
  /** Whether this batch is the one that owns adding and removing rows. */
  showAddRow?: boolean;
}) {
  const { workingCase, dispatch } = useCaseStore();
  const regions = regionsOf(workingCase);

  if (workingCase.units.length === 0) {
    return <div className="rounded-2xl bg-canvas px-4 py-3 text-xs text-muted">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                Row
              </th>
              <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline">
                Region
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-outline ${
                    col.align === "right" ? "text-right" : ""
                  } ${col.width ?? ""}`}
                >
                  {col.label}
                  {col.questionId ? <span className="ml-1 text-slate-300">{col.questionId}</span> : null}
                </th>
              ))}
              {showAddRow ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {workingCase.units.map((unit) => (
              <tr key={unit.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <input
                    type="text"
                    className={`${inputClass} min-w-[10rem]`}
                    value={unit.name}
                    placeholder={unit.region || "Unnamed row"}
                    aria-label={`Name for ${unit.id}`}
                    onChange={(event) =>
                      dispatch({ type: "unit/setName", unitId: unit.id, name: event.target.value })
                    }
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    className={`${inputClass} min-w-[9rem]`}
                    value={unit.region}
                    aria-label={`Region for ${unit.id}`}
                    onChange={(event) =>
                      dispatch({ type: "unit/setRegion", unitId: unit.id, region: event.target.value })
                    }
                  >
                    {/* A region the row already has but which is no longer in the list
                        would otherwise silently rebind the row to the first option. */}
                    {!regions.includes(unit.region) ? (
                      <option value={unit.region}>{unit.region}</option>
                    ) : null}
                    {regions.map((region) => (
                      <option key={region} value={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.render(unit)}
                  </td>
                ))}
                {showAddRow ? (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      onClick={() => dispatch({ type: "unit/remove", unitId: unit.id })}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddRow && regions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-outline">Split a region into another row:</span>
          {regions.map((region) => (
            <button
              key={region}
              type="button"
              className={ghostButtonClass}
              onClick={() => dispatch({ type: "unit/add", region })}
            >
              + {region}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
