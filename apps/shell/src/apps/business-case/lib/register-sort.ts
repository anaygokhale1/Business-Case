/**
 * Sorting for the register table. Pure and framework-free so it can be unit
 * tested without rendering, matching the shape of the reference module's
 * lib/sample-sort.ts.
 */

import { isMissing } from "./engine/alg";
import type { UnitResult } from "./engine/types";

export type SortDir = "asc" | "desc";

export type RegisterColumn =
  | "name"
  | "region"
  | "currentFrontLine"
  | "handleTimeMinutes"
  | "effectiveHours"
  | "requiredFrontLine"
  | "surplus";

/** A register row: the engine's result plus the display name from the case. */
export type RegisterRow = UnitResult & { name: string };

export function nextSortDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

const valueOf = (row: RegisterRow, column: RegisterColumn): string | number => {
  switch (column) {
    case "name":
      return row.name;
    case "region":
      return row.region;
    case "currentFrontLine":
      return row.currentFrontLine;
    case "handleTimeMinutes":
      return row.handleTimeMinutes.value;
    case "effectiveHours":
      return row.effectiveHours.value;
    case "requiredFrontLine":
      return row.requiredFrontLine;
    case "surplus":
      return row.surplus;
  }
};

/**
 * Sorts a copy, never the input.
 *
 * Missing values always sort last regardless of direction. A unit with no volume
 * has no required FTE, and floating it to the top of a descending sort would put
 * the least informative rows where the reader looks first.
 */
export function sortRows(
  rows: RegisterRow[],
  column: RegisterColumn,
  dir: SortDir,
): RegisterRow[] {
  const factor = dir === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    const a = valueOf(left, column);
    const b = valueOf(right, column);

    if (typeof a === "number" && typeof b === "number") {
      const aMissing = isMissing(a);
      const bMissing = isMissing(b);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return (a - b) * factor;
    }

    return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) * factor;
  });
}
