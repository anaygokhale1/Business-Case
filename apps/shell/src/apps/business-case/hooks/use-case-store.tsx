"use client";

/**
 * The working case, held in a reducer and mirrored to localStorage.
 *
 * Local-first (decision 7): a case in progress never leaves the machine until the
 * user explicitly saves it. That also makes a 35-question form usable — losing
 * everything to an accidental reload is the fastest way to make a form untestable.
 *
 * `useReducer` with immutable spreads, not a state library. It preserves object
 * identity for untouched units exactly as structural sharing would, so the engine's
 * per-unit memoisation still hits. See case-reducer.ts.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createBlankCase } from "../lib/case-defaults";
import { readiness, type Readiness } from "../lib/case-questions";
import { caseReducer, type CaseAction } from "../lib/case-reducer";
import { createSampleCase } from "../lib/sample-case";
import type { Case } from "../lib/engine/types";

const STORAGE_VERSION = 1;

interface Persisted {
  version: number;
  case: Case;
  /** Whether the user has pressed Generate, so a reload lands where they left off. */
  generated: boolean;
}

const storageKey = (projectId: string) => `ssa.business-case.${projectId}.v${STORAGE_VERSION}`;

/**
 * Read a saved draft.
 *
 * Anything unexpected returns null rather than throwing — a corrupt or
 * schema-shifted draft must degrade to a blank form, never to a broken module the
 * user cannot get out of without clearing site data.
 */
const readDraft = (projectId: string): Persisted | null => {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Persisted).version !== STORAGE_VERSION ||
      (parsed as Persisted).case?.schema !== "case.workforce.v2"
    ) {
      return null;
    }
    return parsed as Persisted;
  } catch {
    return null;
  }
};

export interface CaseStore {
  workingCase: Case;
  dispatch: (action: CaseAction) => void;
  readiness: Readiness;
  /** True once the user has pressed Generate. The output tab is gated on it. */
  generated: boolean;
  generate: () => void;
  /** Discard everything and start again. */
  reset: () => void;
  /** Load the synthetic demo case, for looking at a finished model. */
  loadSample: () => void;
  /** Bumped whenever the case is replaced wholesale, so inputs re-mount. */
  revision: number;
}

const CaseStoreContext = createContext<CaseStore | null>(null);

export function CaseStoreProvider({
  projectId,
  asOfDate,
  children,
}: {
  projectId: string;
  /**
   * G20 — the as-of date is passed in, never read from the clock inside the model.
   * The provider is the boundary where "today" is allowed to be observed once.
   */
  asOfDate: string;
  children: ReactNode;
}) {
  // Lazy initialiser: the component is mounted client-side only (ssr: false), so
  // touching localStorage here is safe and avoids a blank first paint.
  const [draft] = useState(() => readDraft(projectId));

  const [workingCase, dispatch] = useReducer(
    caseReducer,
    draft?.case ?? createBlankCase(asOfDate),
  );
  const [generated, setGenerated] = useState(draft?.generated ?? false);
  const [revision, setRevision] = useState(0);

  const value = useMemo<CaseStore>(() => {
    const replace = (next: Case, isGenerated: boolean) => {
      dispatch({ type: "case/replace", case: next });
      setGenerated(isGenerated);
      setRevision((r) => r + 1);
    };
    return {
      workingCase,
      dispatch,
      readiness: readiness(workingCase),
      generated,
      generate: () => setGenerated(true),
      reset: () => replace(createBlankCase(asOfDate), false),
      loadSample: () => replace(createSampleCase(), true),
      revision,
    };
  }, [workingCase, generated, revision, asOfDate]);

  /* --------------------------- persistence ------------------------------- */

  // Skip the write that would otherwise fire on mount and rewrite the draft we
  // just read — harmless, but it would also stamp a blank case over a real draft
  // if the read ever failed.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const payload: Persisted = { version: STORAGE_VERSION, case: workingCase, generated };
    try {
      window.localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
    } catch {
      // Quota or a private-browsing restriction. The in-memory case is unaffected,
      // and silently losing persistence is better than breaking the form.
    }
  }, [workingCase, generated, projectId]);

  return <CaseStoreContext.Provider value={value}>{children}</CaseStoreContext.Provider>;
}

export function useCaseStore(): CaseStore {
  const store = useContext(CaseStoreContext);
  if (!store) {
    throw new Error("useCaseStore must be used inside <CaseStoreProvider>.");
  }
  return store;
}

/** Narrow helper for the many fields that only need to dispatch. */
export function useCaseDispatch(): (action: CaseAction) => void {
  return useCaseStore().dispatch;
}

/** Stable callback for a single meta field. */
export function useMetaField(field: keyof Case["meta"]) {
  const { workingCase, dispatch } = useCaseStore();
  const set = useCallback(
    (value: string) => dispatch({ type: "meta/set", field, value }),
    [dispatch, field],
  );
  return [workingCase.meta[field], set] as const;
}
