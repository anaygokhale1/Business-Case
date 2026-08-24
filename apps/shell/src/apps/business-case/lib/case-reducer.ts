/**
 * The case reducer — every edit the input form can make, as one pure function.
 *
 * Two properties are load-bearing and easy to lose:
 *
 *  1. **Identity preservation.** An action that touches one unit must return the
 *     *same object references* for every other unit. The engine memoises per-unit
 *     results in a `WeakMap` keyed on the unit object, so a reducer that rebuilds
 *     the whole array on every keystroke silently turns an O(1) edit into O(n).
 *     Hence `map` with an id guard rather than `structuredClone` of the case.
 *
 *  2. **Absent vs. present-but-missing.** Clearing an inheritable driver `delete`s
 *     the key so the unit inherits again; marking it unavailable assigns SENTINEL.
 *     Assigning `undefined` would satisfy neither and would not survive a JSON
 *     round-trip, which is why `exactOptionalPropertyTypes` stays on.
 */

import { applyPreset, applyStudy, applyVolumes } from "./capacity-populate";
import type { CapacityPreset } from "./case-presets";
import { benchmarkFor, STANDARD_PHASE_WEIGHTS, SUGGESTED_SCENARIOS } from "./case-defaults";
import type { InheritableDriver } from "./engine/drivers";
import { normaliseRole } from "./engine/process-study";
import type {
  CapacityBlock,
  Case,
  CaseModel,
  DemandCell,
  Driver,
  ExitProfile,
  Globals,
  Role,
  RoleCapacity,
  RoleTier,
  ScenarioKey,
  TimeStudyRow,
  Unit,
} from "./engine/types";
import type { StudyImportResult } from "./import/process-study-map";
import { SENTINEL } from "./engine/types";

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `number` sets a value, SENTINEL marks it known-missing, `null` clears it back to
 * inherited. `null` rather than `undefined` so the intent is explicit at the call
 * site and cannot arrive by accident from an unset variable.
 */
export type DriverInput = number | typeof SENTINEL | null;

export type CaseAction =
  | { type: "case/replace"; case: Case }
  | { type: "meta/set"; field: keyof Case["meta"]; value: string }
  | { type: "globals/setNumber"; field: NumericGlobal; value: number }
  | { type: "globals/setChoice"; patch: Partial<Globals> }
  | { type: "scenario/set"; scenario: ScenarioKey; hcReductionPct: number }
  | { type: "role/add"; tier: RoleTier }
  | { type: "role/setTitle"; roleId: string; title: string }
  | { type: "role/setTier"; roleId: string; tier: RoleTier }
  | { type: "role/remove"; roleId: string }
  | { type: "region/add"; name: string }
  | { type: "region/rename"; from: string; to: string }
  | { type: "region/remove"; name: string }
  | { type: "region/setDriver"; region: string; driver: InheritableDriver; value: DriverInput }
  | { type: "unit/add"; region: string }
  | { type: "unit/setName"; unitId: string; name: string }
  | { type: "unit/setRegion"; unitId: string; region: string }
  | { type: "unit/setVolume"; unitId: string; value: number | typeof SENTINEL }
  | { type: "unit/setDriver"; unitId: string; driver: InheritableDriver; value: DriverInput }
  | { type: "unit/setHeadcount"; unitId: string; roleId: string; value: Driver }
  | { type: "unit/setCost"; unitId: string; roleId: string; value: Driver }
  | { type: "unit/remove"; unitId: string }
  | { type: "timeStudy/add"; region?: string }
  | { type: "timeStudy/set"; index: number; patch: Partial<TimeStudyRow> }
  | { type: "timeStudy/setRegion"; index: number; region: string | null }
  | { type: "timeStudy/remove"; index: number }
  | { type: "timeStudy/replaceScope"; region: string | null; rows: TimeStudyRow[] }
  | { type: "timeStudy/append"; rows: TimeStudyRow[] }
  | { type: "timeStudy/clear" }
  | { type: "timeStudy/adoptVolume"; region: string }
  | { type: "phaseWeights/set"; profile: ExitProfile; index: number; value: number }
  | { type: "phaseWeights/resize"; phaseCount: number }
  | { type: "benchmark/applyCompensation" }
  | { type: "scenario/applySuggestedSpread" }
  /* ---- capacity model ---- */
  | { type: "capacity/applyStudy"; study: StudyImportResult; fileName?: string; at?: string }
  | { type: "capacity/applyVolumes"; demand: DemandCell[]; fileName?: string; at?: string }
  | { type: "capacity/setColumn"; which: "base" | "target"; column: string }
  | { type: "capacity/setRoleParam"; role: string; patch: Partial<RoleCapacity> }
  | { type: "capacity/setExcludedRowIds"; rowIds: string[] }
  | { type: "capacity/clear" }
  | { type: "capacity/applyPreset"; preset: CapacityPreset }
  | { type: "capacity/setNumber"; field: CapacityNumber; value: number }
  | { type: "capacity/setCurrency"; currency: string }
  | { type: "model/set"; model: CaseModel };

/** Capacity fields the form edits as free numbers. */
export type CapacityNumber = "redeploymentRate" | "recruitmentCostPct";

/** Globals the form edits as free numbers. Enums go through `globals/setChoice`. */
export type NumericGlobal =
  | "workingHoursPerYear"
  | "utilisationPct"
  | "handleTimeMinutes"
  | "upliftPct"
  | "spanOfControl"
  | "severanceWeeks"
  | "horizonYears"
  | "consultingCost"
  | "noticeMonths"
  | "phaseCount"
  | "monthsPerPhase";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * A stable unique id. Deterministic — derived from what is already there, never
 * from a clock or a random number, so a reducer sequence replays identically in a
 * test and a saved case diffs cleanly.
 */
export const uniqueId = (base: string, taken: Iterable<string>): string => {
  const used = new Set(taken);
  const stem = base || "item";
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(`${stem}-${n}`)) n += 1;
  return `${stem}-${n}`;
};

/** Region list, derived from the units. Regions are not stored separately — a
 *  region with no unit has nothing to contribute, so it is not a thing to hold. */
export const regionsOf = (c: Case): string[] => {
  const seen: string[] = [];
  for (const u of c.units) if (!seen.includes(u.region)) seen.push(u.region);
  return seen;
};

/**
 * What a region-level driver box should show.
 *
 * "mixed" is a real state and must be displayed as such. Showing one of the values,
 * or showing the global, would let a user overwrite two teams' distinct figures with
 * one number without being told that is what they were doing.
 */
export type RegionDriverSummary =
  | { kind: "uniform"; value: number }
  | { kind: "inherited" }
  | { kind: "missing" }
  | { kind: "mixed" };

export const regionDriverSummary = (
  c: Case,
  region: string,
  driver: InheritableDriver,
): RegionDriverSummary => {
  const values = c.units.filter((u) => u.region === region).map((u) => u[driver]);
  if (values.length === 0) return { kind: "inherited" };

  const first = values[0];
  const allSame = values.every((v) => v === first);
  if (!allSame) return { kind: "mixed" };
  if (first === SENTINEL) return { kind: "missing" };
  if (typeof first === "number") return { kind: "uniform", value: first };
  return { kind: "inherited" };
};

/** Apply a patch to one unit, leaving every other unit object untouched. */
const patchUnit = (c: Case, unitId: string, patch: (u: Unit) => Unit): Case => {
  let hit = false;
  const units = c.units.map((u) => {
    if (u.id !== unitId) return u;
    hit = true;
    return patch(u);
  });
  return hit ? { ...c, units } : c;
};

/** Set, sentinel or clear an optional driver key. */
const applyDriver = (unit: Unit, driver: InheritableDriver, value: DriverInput): Unit => {
  const next: Unit = { ...unit };
  if (value === null) {
    // Back to inherited. The key must be gone, not undefined — see the file header.
    delete next[driver];
    return next;
  }
  next[driver] = value;
  return next;
};

const setRoleMapEntry = (
  map: Record<string, Driver>,
  roleId: string,
  value: Driver,
): Record<string, Driver> => ({ ...map, [roleId]: value });

const blankUnit = (id: string, name: string, region: string): Unit => ({
  id,
  name,
  region,
  // Known-missing rather than 0. A unit created but not yet answered contributes no
  // required FTE and says so; a 0 would claim the unit genuinely has no demand.
  volume: SENTINEL,
  headcount: {},
  cost: {},
});

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

export function caseReducer(state: Case, action: CaseAction): Case {
  switch (action.type) {
    case "case/replace":
      return action.case;

    case "meta/set":
      return { ...state, meta: { ...state.meta, [action.field]: action.value } };

    case "globals/setNumber":
      return { ...state, globals: { ...state.globals, [action.field]: action.value } };

    case "globals/setChoice":
      return { ...state, globals: { ...state.globals, ...action.patch } };

    case "scenario/applySuggestedSpread":
      // An explicit press, not a pre-fill. The reduction target drives the headline
      // number more than any other input, so the user has to choose to accept the
      // 8 / 12 / 18 spread rather than find it already filled in.
      return { ...state, scenarios: structuredClone(SUGGESTED_SCENARIOS) };

    case "scenario/set":
      return {
        ...state,
        scenarios: {
          ...state.scenarios,
          [action.scenario]: { hcReductionPct: action.hcReductionPct },
        },
      };

    /* ---------------------------- roles ---------------------------------- */

    case "role/add": {
      const id = uniqueId(action.tier === "manager" ? "manager" : "role", state.roles.map((r) => r.id));
      const role: Role = { id, title: "", tier: action.tier };
      return { ...state, roles: [...state.roles, role] };
    }

    case "role/setTitle":
      return {
        ...state,
        roles: state.roles.map((r) =>
          r.id === action.roleId ? { ...r, title: action.title } : r,
        ),
      };

    case "role/setTier":
      return {
        ...state,
        roles: state.roles.map((r) => (r.id === action.roleId ? { ...r, tier: action.tier } : r)),
      };

    case "role/remove": {
      const roles = state.roles.filter((r) => r.id !== action.roleId);
      // Removing a role must also drop its headcount and cost from every unit, or
      // the blended-cost SUMPRODUCT keeps weighting a role that no longer exists.
      const units = state.units.map((u) => {
        if (!(action.roleId in u.headcount) && !(action.roleId in u.cost)) return u;
        const headcount = { ...u.headcount };
        const cost = { ...u.cost };
        delete headcount[action.roleId];
        delete cost[action.roleId];
        return { ...u, headcount, cost };
      });
      return { ...state, roles, units };
    }

    /* --------------------------- regions --------------------------------- */

    case "region/add": {
      const name = action.name.trim();
      if (name === "" || regionsOf(state).includes(name)) return state;
      // A region arrives with one unit, because the skill asks for volume, headcount
      // and cost *per region*. Splitting a region into several units is the Units
      // step; this keeps the simple case one row per region with nothing extra to
      // fill in, and needs no separate region list to fall out of sync with.
      const id = uniqueId(slugify(name), state.units.map((u) => u.id));
      return { ...state, units: [...state.units, blankUnit(id, name, name)] };
    }

    case "region/rename": {
      const to = action.to.trim();
      if (to === "" || to === action.from) return state;
      return {
        ...state,
        units: state.units.map((u) => {
          if (u.region !== action.from) return u;
          // A unit that was auto-created for the region carries the region's name,
          // so rename both. A unit the user named keeps its own name.
          const name = u.name === action.from ? to : u.name;
          return { ...u, region: to, name };
        }),
      };
    }

    case "region/remove":
      return { ...state, units: state.units.filter((u) => u.region !== action.name) };

    case "region/setDriver": {
      // The skill asks for working hours and utilisation *per region*, but the model's
      // grain is the unit, and adding a third inheritance layer between them would
      // mean a value could be "inherited" from two places at once. So a region-level
      // edit writes through to every unit in the region and is honestly reported as
      // the unit's own value — see `regionDriverSummary` for how the form shows it.
      let touched = false;
      const units = state.units.map((u) => {
        if (u.region !== action.region) return u;
        touched = true;
        return applyDriver(u, action.driver, action.value);
      });
      return touched ? { ...state, units } : state;
    }

    /* ---------------------------- units ---------------------------------- */

    case "unit/add": {
      const id = uniqueId(
        slugify(`${action.region}-unit`),
        state.units.map((u) => u.id),
      );
      return { ...state, units: [...state.units, blankUnit(id, "", action.region)] };
    }

    case "unit/setName":
      return patchUnit(state, action.unitId, (u) => ({ ...u, name: action.name }));

    case "unit/setRegion":
      return patchUnit(state, action.unitId, (u) => ({ ...u, region: action.region }));

    case "unit/setVolume":
      return patchUnit(state, action.unitId, (u) => ({ ...u, volume: action.value }));

    case "unit/setDriver":
      return patchUnit(state, action.unitId, (u) => applyDriver(u, action.driver, action.value));

    case "unit/setHeadcount":
      return patchUnit(state, action.unitId, (u) => ({
        ...u,
        headcount: setRoleMapEntry(u.headcount, action.roleId, action.value),
      }));

    case "unit/setCost":
      return patchUnit(state, action.unitId, (u) => ({
        ...u,
        cost: setRoleMapEntry(u.cost, action.roleId, action.value),
      }));

    case "unit/remove":
      return { ...state, units: state.units.filter((u) => u.id !== action.unitId) };

    /* -------------------------- time study -------------------------------- */

    case "timeStudy/add": {
      const row: TimeStudyRow = { taskType: "", minutes: 0, volume: 0 };
      // Absent region means portfolio-wide, so the key is only set when there is one.
      if (action.region !== undefined) row.region = action.region;
      return { ...state, timeStudy: [...state.timeStudy, row] };
    }

    case "timeStudy/set":
      return {
        ...state,
        timeStudy: state.timeStudy.map((row, i) =>
          i === action.index ? { ...row, ...action.patch } : row,
        ),
      };

    case "timeStudy/setRegion":
      return {
        ...state,
        timeStudy: state.timeStudy.map((row, i) => {
          if (i !== action.index) return row;
          const next: TimeStudyRow = { ...row };
          // null means portfolio-wide, which is the ABSENCE of the key rather than a
          // region called "". Same reason as the inheritable drivers.
          if (action.region === null) delete next.region;
          else next.region = action.region;
          return next;
        }),
      };

    case "timeStudy/remove":
      return { ...state, timeStudy: state.timeStudy.filter((_, i) => i !== action.index) };

    case "timeStudy/replaceScope": {
      // An import replaces the scope it targets rather than appending to it, so
      // re-importing a corrected file does not silently double the volumes.
      const kept = state.timeStudy.filter((row) =>
        action.region === null ? row.region !== undefined : row.region !== action.region,
      );
      return { ...state, timeStudy: [...kept, ...action.rows] };
    }

    case "timeStudy/append":
      return { ...state, timeStudy: [...state.timeStudy, ...action.rows] };

    case "timeStudy/clear":
      return { ...state, timeStudy: [] };

    case "timeStudy/adoptVolume": {
      // Set the region's registered volume from its study. Only meaningful when the
      // study is believed to cover all of the region's work — which is exactly the
      // condition G25 checks — so it is an explicit press, never automatic.
      const total = state.timeStudy
        .filter((r) => r.region === action.region)
        .reduce((acc, r) => acc + r.volume, 0);
      if (total <= 0) return state;

      const inRegion = state.units.filter((u) => u.region === action.region);
      if (inRegion.length !== 1) {
        // With several rows in the region there is no non-arbitrary way to split the
        // studied volume between them, and inventing a split would be worse than
        // declining. The UI only offers the button for a single-row region.
        return state;
      }
      return patchUnit(state, inRegion[0]!.id, (u) => ({ ...u, volume: total }));
    }

    /* ------------------------- phase weights ----------------------------- */

    case "phaseWeights/set": {
      const current = state.globals.phaseWeights[action.profile] ?? [];
      const next = current.map((w, i) => (i === action.index ? action.value : w));
      return {
        ...state,
        globals: {
          ...state.globals,
          phaseWeights: { ...state.globals.phaseWeights, [action.profile]: next },
        },
      };
    }

    case "phaseWeights/resize": {
      const n = action.phaseCount;
      if (!Number.isInteger(n) || n < 1) return state;
      // An even split, offered explicitly rather than applied when phaseCount
      // changes. Silently reshaping the weights would overwrite a front-loaded
      // profile the user chose deliberately; G9 flags the mismatch instead, and
      // this is the button that resolves it.
      const even = Array.from({ length: n }, () => 1 / n);
      const rebuilt = Object.fromEntries(
        (Object.keys(state.globals.phaseWeights) as ExitProfile[]).map((profile) => {
          const standard = STANDARD_PHASE_WEIGHTS[profile];
          return [profile, standard.length === n ? [...standard] : even];
        }),
      ) as Record<ExitProfile, number[]>;
      return {
        ...state,
        globals: { ...state.globals, phaseCount: n, phaseWeights: rebuilt },
      };
    }

    /* --------------------------- benchmarks ------------------------------ */

    case "benchmark/applyCompensation": {
      const bench = benchmarkFor(state.meta.industry);
      if (!bench) return state;
      const frontLine = state.roles.filter((r) => r.tier === "front-line").map((r) => r.id);
      const managers = state.roles.filter((r) => r.tier === "manager").map((r) => r.id);
      return {
        ...state,
        units: state.units.map((u) => {
          const cost = { ...u.cost };
          // Only fills gaps. A figure the user typed is an answer and a benchmark is
          // not, so the benchmark never overwrites one.
          for (const id of frontLine) if (cost[id] === undefined) cost[id] = bench.frontLine;
          for (const id of managers) if (cost[id] === undefined) cost[id] = bench.manager;
          return { ...u, cost };
        }),
      };
    }

    /* --------------------------- capacity -------------------------------- */

    case "capacity/applyStudy":
      // The summary is for the UI to report; the reducer keeps only the case.
      return applyStudy(state, action.study, action.fileName, action.at).next;

    case "capacity/applyVolumes":
      return applyVolumes(state, action.demand, action.fileName, action.at);

    case "capacity/setColumn": {
      if (!state.capacity) return state;
      const capacity: CapacityBlock = {
        ...state.capacity,
        ...(action.which === "base"
          ? { baseColumn: action.column }
          : { targetColumn: action.column }),
      };
      return { ...state, capacity };
    }

    case "capacity/setRoleParam": {
      if (!state.capacity) return state;
      const target = normaliseRole(action.role);
      let hit = false;
      const roles = state.capacity.roles.map((r) => {
        if (normaliseRole(r.role) !== target) return r;
        hit = true;
        return { ...r, ...action.patch };
      });
      if (!hit) return state;
      return { ...state, capacity: { ...state.capacity, roles } };
    }

    case "capacity/setExcludedRowIds": {
      if (!state.capacity) return state;
      return { ...state, capacity: { ...state.capacity, excludedRowIds: action.rowIds } };
    }

    case "capacity/clear": {
      if (!state.capacity) return state;
      const next = { ...state, model: "reduction" as CaseModel };
      delete next.capacity;
      return next;
    }

    case "capacity/applyPreset":
      return applyPreset(state, action.preset);

    case "capacity/setNumber": {
      if (!state.capacity) return state;
      return { ...state, capacity: { ...state.capacity, [action.field]: action.value } };
    }

    case "capacity/setCurrency": {
      if (!state.capacity) return state;
      // Recorded, never used to convert. A case that silently applied an FX rate would be
      // stating a rate and a date nobody agreed to.
      return { ...state, capacity: { ...state.capacity, currency: action.currency } };
    }

    case "model/set":
      return { ...state, model: action.model };

    default: {
      // Exhaustiveness: a new action with no case fails to compile here.
      const never: never = action;
      return never;
    }
  }
}
