"use client";

import { useMemo, useState } from "react";

import {
  nextSortDir,
  sortRows,
  type RegisterColumn,
  type RegisterRow,
  type SortDir,
} from "../lib/register-sort";

/**
 * Sort state for the register. The comparison itself lives in lib/register-sort so
 * it can be tested without rendering; this only holds which column and direction.
 */
export function useRegisterSort(rows: RegisterRow[]) {
  const [column, setColumn] = useState<RegisterColumn>("surplus");
  const [dir, setDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => sortRows(rows, column, dir), [rows, column, dir]);

  const toggle = (next: RegisterColumn) => {
    if (next === column) {
      setDir((current) => nextSortDir(current));
      return;
    }
    setColumn(next);
    // A new column starts descending for numbers, because the largest surplus or
    // the worst deficit is what a reader wants first, and ascending for text.
    setDir(next === "name" || next === "region" ? "asc" : "desc");
  };

  return { sorted, column, dir, toggle };
}
