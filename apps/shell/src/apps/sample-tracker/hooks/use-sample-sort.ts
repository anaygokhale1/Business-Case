"use client";

import { useMemo, useState } from "react";

import {
  nextSortDir,
  sortItems,
  type SampleItemRow,
  type SortableColumn,
  type SortDir
} from "../lib/sample-sort";

// Small hook wrapping the pure sort helpers with column + direction state.
export function useSampleSort(items: SampleItemRow[], initialColumn: SortableColumn = "createdAt") {
  const [column, setColumn] = useState<SortableColumn>(initialColumn);
  const [dir, setDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => sortItems(items, column, dir), [items, column, dir]);

  const toggle = (next: SortableColumn) => {
    if (next === column) {
      setDir((current) => nextSortDir(current));
    } else {
      setColumn(next);
      setDir("asc");
    }
  };

  return { sorted, column, dir, toggle };
}
