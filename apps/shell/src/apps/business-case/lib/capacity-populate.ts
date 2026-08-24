/**
 * Turning two uploaded files into a populated case.
 *
 * An import is not just a data load — it answers questions the form would otherwise ask.
 * The study names the roles, the regions and the lines of business; the volume sheet gives
 * the demand and, via its counts, the outcome mix. All of that should land in the
 * questionnaire so the user is correcting a filled-in form rather than typing it again.
 *
 * What an import must NOT do is invent the things it cannot know. Working hours and
 * utilisation are not in either file, so roles arrive holding the documented default and
 * badged as a default — never as though the file had supplied them.
 */

import { DEFAULT_GLOBALS } from "./case-defaults";
import type {
  CapacityBlock,
  Case,
  DemandCell,
  ProcessRow,
  Role,
  RoleCapacity,
  RoleTier,
} from "./engine/types";
import { normaliseRole } from "./engine/process-study";
import type { StudyImportResult } from "./import/process-study-map";

/* -------------------------------------------------------------------------- */
/* Role classification                                                        */
/* -------------------------------------------------------------------------- */

/** Names that mean "a system does this", so the work leaves human capacity. */
const AUTOMATION_HINTS = ["system", "automation", "automated", "robot", "rpa", "bot", "straightthrough", "stp"];

/** Names that are a placeholder rather than a team. */
const UNASSIGNED_HINTS = ["na", "n/a", "tbd", "tbc", "none", "unassigned", "unknown", "notapplicable", "?"];

/** Names that read as a management tier. */
const MANAGER_HINTS = ["manager", "lead", "teamlead", "supervisor", "head", "director", "chief"];

const key = (role: string) => normaliseRole(role).toLowerCase().replace(/[^a-z0-9]/g, "");

export type RoleKind = "staffed" | "automated" | "unassigned";

/**
 * Classify a role name.
 *
 * A guess, and it has to be reviewable: calling a real team "automation" would delete its
 * people from the model, and calling an automation target "staffed" would put people
 * against work nobody does. Both are surfaced in the import report for confirmation.
 */
export const classifyRole = (role: string): RoleKind => {
  const k = key(role);
  if (k === "") return "unassigned";
  if (UNASSIGNED_HINTS.some((h) => k === key(h))) return "unassigned";
  if (AUTOMATION_HINTS.some((h) => k === h || k.startsWith(h))) return "automated";
  return "staffed";
};

export const inferTier = (role: string): RoleTier => {
  const k = key(role);
  if (classifyRole(role) !== "staffed") return "other";
  return MANAGER_HINTS.some((h) => k.includes(h)) ? "manager" : "front-line";
};

/**
 * Build capacity parameters for every role the study names.
 *
 * Existing parameters win, so re-importing a corrected study does not wipe hours and
 * utilisation the user has already entered.
 */
export const buildRoleParams = (
  roles: string[],
  existing: RoleCapacity[] = [],
): RoleCapacity[] => {
  const byRole = new Map(existing.map((r) => [normaliseRole(r.role), r]));

  return roles
    .map((raw) => normaliseRole(raw))
    .filter((role, i, all) => role !== "" && all.indexOf(role) === i)
    .map((role) => {
      const kept = byRole.get(role);
      if (kept) return kept;

      const kind = classifyRole(role);
      const params: RoleCapacity = {
        role,
        // Neither file carries these. The documented defaults are used and reported as
        // defaults; the form badges them until the user changes them.
        workingHoursPerYear: kind === "staffed" ? DEFAULT_GLOBALS.workingHoursPerYear : 0,
        utilisationPct: kind === "staffed" ? DEFAULT_GLOBALS.utilisationPct : 0,
      };
      if (kind === "automated") params.automated = true;
      if (kind === "unassigned") params.unassigned = true;
      return params;
    });
};

/* -------------------------------------------------------------------------- */
/* Choosing the base and target columns                                       */
/* -------------------------------------------------------------------------- */

const BASE_PREFERENCE = ["current", "asis", "today", "existing"];
const TARGET_PREFERENCE = ["target", "proposed", "future", "tobe", "madridoutcome"];

/**
 * Which column is the as-is and which the to-be.
 *
 * Preference order, then position: the as-is is almost always called "current", and where
 * several to-be columns exist the first by preference wins. Both are shown and changeable
 * — a study carrying three disagreeing to-be columns is normal, and which one is the
 * target is the case's decision, not the file's.
 */
export const chooseColumns = (
  roleColumns: string[],
): { baseColumn: string; targetColumn: string } => {
  const found = (preferences: string[]) =>
    preferences.map((p) => roleColumns.find((c) => c === p || c.startsWith(p))).find((c) => c !== undefined);

  const baseColumn = found(BASE_PREFERENCE) ?? roleColumns[0] ?? "current";
  const targetColumn =
    found(TARGET_PREFERENCE.filter((p) => !baseColumn.startsWith(p))) ??
    roleColumns.find((c) => c !== baseColumn) ??
    baseColumn;

  return { baseColumn, targetColumn };
};

/* -------------------------------------------------------------------------- */
/* Populating                                                                 */
/* -------------------------------------------------------------------------- */

export interface PopulateSummary {
  stepCount: number;
  roles: Array<{ role: string; kind: RoleKind }>;
  regions: string[];
  lobs: string[];
  transactionTypes: string[];
  baseColumn: string;
  targetColumn: string;
  /** Role columns available to choose between as the target. */
  roleColumns: string[];
}

/**
 * Apply an imported study to a case.
 *
 * Demand is left alone here. The two files are uploaded independently and in either order,
 * so a study import must not wipe volumes that are already in place.
 */
export const applyStudy = (
  c: Case,
  study: StudyImportResult,
  fileName?: string,
  importedAt?: string,
): { next: Case; summary: PopulateSummary } => {
  const previous = c.capacity;
  const roleColumns = study.discovered.roleColumns;
  const chosen = chooseColumns(roleColumns);

  // A column the user already chose is kept if the new file still has it — re-importing a
  // corrected study should not silently move the target state.
  const baseColumn =
    previous && roleColumns.includes(previous.baseColumn) ? previous.baseColumn : chosen.baseColumn;
  const targetColumn =
    previous && roleColumns.includes(previous.targetColumn)
      ? previous.targetColumn
      : chosen.targetColumn;

  const capacity: CapacityBlock = {
    rows: study.rows,
    demand: previous?.demand ?? [],
    statusShares: previous?.statusShares ?? {},
    roles: buildRoleParams(study.discovered.roles, previous?.roles ?? []),
    roleColumns,
    baseColumn,
    targetColumn,
    // Duplicate decisions are per row id, so any that survive the new file are kept.
    excludedRowIds: (previous?.excludedRowIds ?? []).filter((id) =>
      study.rows.some((r) => r.id === id),
    ),
    source: {
      ...(previous?.source ?? {}),
      ...(fileName ? { studyFile: fileName } : {}),
      ...(importedAt ? { importedAt } : {}),
    },
  };

  const next: Case = {
    ...c,
    model: "capacity",
    capacity,
    // The study names the roles, so the questionnaire's role list is filled from it
    // rather than asked for again. Titles the user already set are preserved.
    roles: mergeRoles(c.roles, study.discovered.roles),
  };

  return {
    next,
    summary: {
      stepCount: study.rows.length,
      roles: study.discovered.roles.map((role) => ({ role, kind: classifyRole(role) })),
      regions: study.discovered.regions,
      lobs: study.discovered.lobs,
      transactionTypes: study.discovered.transactionTypes,
      baseColumn,
      targetColumn,
      roleColumns,
    },
  };
};

/**
 * Fold the study's roles into the case's role list.
 *
 * A role the user already titled keeps its title and tier. The id is derived from the
 * study's own name so the two lists stay joined across a re-import.
 */
const mergeRoles = (existing: Role[], discovered: string[]): Role[] => {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const fromStudy: Role[] = discovered
    .map((raw) => normaliseRole(raw))
    .filter((role, i, all) => role !== "" && all.indexOf(role) === i)
    .map((role) => {
      const id = key(role) || role;
      const kept = byId.get(id);
      return kept ?? { id, title: role, tier: inferTier(role) };
    });

  // Roles the user added by hand that the study does not mention are kept, so an import
  // never silently deletes something someone typed. Blank starter rows are dropped.
  const untouched = existing.filter(
    (r) => !fromStudy.some((f) => f.id === r.id) && r.title.trim() !== "",
  );

  return [...fromStudy, ...untouched];
};

/** Apply imported volumes, leaving the study alone. */
export const applyVolumes = (
  c: Case,
  demand: DemandCell[],
  fileName?: string,
  importedAt?: string,
): Case => {
  const previous = c.capacity;
  const capacity: CapacityBlock = {
    rows: previous?.rows ?? [],
    demand,
    statusShares: previous?.statusShares ?? {},
    roles: previous?.roles ?? [],
    roleColumns: previous?.roleColumns ?? [],
    baseColumn: previous?.baseColumn ?? "current",
    targetColumn: previous?.targetColumn ?? "current",
    excludedRowIds: previous?.excludedRowIds ?? [],
    source: {
      ...(previous?.source ?? {}),
      ...(fileName ? { volumesFile: fileName } : {}),
      ...(importedAt ? { importedAt } : {}),
    },
  };
  return { ...c, model: "capacity", capacity };
};

/** Steps in the study that no demand cell reaches, so their minutes never count. */
export const unreachedSteps = (block: CapacityBlock): ProcessRow[] => {
  const lobs = new Set(block.demand.map((d) => d.lob));
  const types = new Set(block.demand.map((d) => d.transactionType));
  return block.rows.filter(
    (row) =>
      !lobs.has(row.lob) ||
      (row.transactionTypes.length > 0 && !row.transactionTypes.some((t) => types.has(t))),
  );
};
