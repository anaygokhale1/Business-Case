/**
 * Putting a currency figure on a capacity change.
 *
 * The delta is target-required against current-required: the same work, differently
 * assigned. That has one consequence worth stating at the top, because it bounds what
 * this module can honestly claim — it says nothing about whether the operation is
 * overstaffed today. `actual headcount − required(current)` is a separate finding and
 * needs an input neither the study nor the volume sheet carries.
 *
 * Three rules the arithmetic follows:
 *
 *  1. Cost is per role AND location. In a right-shift most of the saving comes from work
 *     moving somewhere cheaper rather than to a cheaper grade in the same place, and a
 *     cost keyed on role alone cannot tell those apart.
 *  2. The run-rate is costed on the FRACTIONAL delta; whole FTE is reported beside it.
 *     The delta of two rounded numbers is not the rounding of the delta — they differ by
 *     up to a person per role — so both are shown and neither is presented as the other.
 *  3. A role with no cost is excluded from the money and named. Treating a missing cost
 *     as zero reads as a role that is free, which is the direction that flatters the case.
 */

import { MISSING, isMissing, round6 } from "./alg";
import { compareCapacity, type CapacityComparison } from "./capacity";
import type { CapacityBlock, Driver, RoleCapacity } from "./types";
import { SENTINEL } from "./types";

/* -------------------------------------------------------------------------- */
/* Cost lookup                                                               */
/* -------------------------------------------------------------------------- */

const costOf = (role: RoleCapacity | undefined): number => {
  if (!role) return MISSING;
  const raw: Driver | undefined = role.annualCost;
  if (raw === undefined || raw === SENTINEL) return MISSING;
  return raw;
};

/** "UA @ Hub" — the label the output uses, so the location is never implicit. */
export const roleLabel = (role: RoleCapacity): string =>
  role.location && role.location.trim() !== "" ? `${role.role} @ ${role.location}` : role.role;

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export interface RoleValuation {
  role: string;
  location: string;
  label: string;
  /** All-in annual cost of one FTE. MISSING when not supplied. */
  annualCost: number;

  fromFte: number;
  toFte: number;
  /** Positive means the role grows. */
  deltaFte: number;

  /** Rounded up per role, as an operating plan would have to. */
  fromWholeFte: number;
  toWholeFte: number;
  deltaWholeFte: number;

  /** deltaFte x annualCost. Negative is a saving. MISSING when there is no cost. */
  deltaCost: number;
  /** The same on whole FTE, for the operating-plan view. */
  deltaCostWhole: number;

  automated: boolean;
  unassigned: boolean;
}

export interface CapacityValuation {
  currency: string;
  baseColumn: string;
  targetColumn: string;

  roles: RoleValuation[];

  /** Annual cost of the staffed roles under each assignment. */
  annualCostFrom: number;
  annualCostTo: number;
  /**
   * Positive is a saving. The headline: what the reallocation is worth per year, on the
   * fractional requirement.
   */
  grossAnnualSaving: number;
  /** The same on whole FTE. Differs from the above, and is not a rounding of it. */
  grossAnnualSavingWhole: number;

  /** Fractional FTE leaving roles that shrink, and joining roles that grow. */
  fteOut: number;
  fteIn: number;
  netFteChange: number;

  /** People who leave: the share of `fteOut` redeployment does not absorb. */
  exitingFte: number;
  /** Growth that redeployment does not fill and so has to be recruited. */
  unfilledFte: number;
  redeployedFte: number;

  severanceCost: number;
  recruitmentCost: number;
  oneTimeCost: number;

  /** Months to recover the one-time cost from the annual saving. MISSING if it never does. */
  paybackMonths: number;

  /** Roles carrying an FTE change but no cost, so excluded from the money. */
  rolesWithoutCost: string[];
  /** FTE change those roles account for — the size of what the money is missing. */
  uncostedFteChange: number;

  comparison: CapacityComparison;
}

/* -------------------------------------------------------------------------- */
/* Valuation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ValuationParams {
  /** Weeks of pay per exiting FTE. Reuses the case's own severance basis. */
  severanceWeeks: number;
  /** Whether severance and recruitment are modelled at all. */
  includeOneTimeCosts: boolean;
}

const WEEKS_PER_YEAR = 52;

const ceil = (x: number) => (isMissing(x) ? MISSING : Math.ceil(round6(x)));
const zero = (x: number) => (isMissing(x) ? 0 : x);

export const valueCapacity = (
  block: CapacityBlock,
  params: ValuationParams,
): CapacityValuation => {
  const excludeRowIds = new Set(block.excludedRowIds);
  const comparison = compareCapacity(block, block.baseColumn, block.targetColumn, {
    excludeRowIds,
  });

  const paramsByRole = new Map(block.roles.map((r) => [r.role, r]));

  const roles: RoleValuation[] = comparison.roles.map((delta) => {
    const config = paramsByRole.get(delta.role);
    const annualCost = costOf(config);
    const fromFte = zero(delta.fromFte);
    const toFte = zero(delta.toFte);
    const special = delta.automated || delta.unassigned;

    // Whole FTE is computed from each side independently and the difference taken, which
    // is NOT the same as rounding the difference. That is the point of showing both.
    const fromWholeFte = special ? 0 : zero(ceil(fromFte));
    const toWholeFte = special ? 0 : zero(ceil(toFte));

    const costable = !special && !isMissing(annualCost);

    return {
      role: delta.role,
      location: config?.location ?? "",
      label: config ? roleLabel(config) : delta.role,
      annualCost,
      fromFte,
      toFte,
      deltaFte: delta.deltaFte,
      fromWholeFte,
      toWholeFte,
      deltaWholeFte: toWholeFte - fromWholeFte,
      deltaCost: costable ? delta.deltaFte * annualCost : MISSING,
      deltaCostWhole: costable ? (toWholeFte - fromWholeFte) * annualCost : MISSING,
      automated: delta.automated,
      unassigned: delta.unassigned,
    };
  });

  const staffed = roles.filter((r) => !r.automated && !r.unassigned);
  const costed = staffed.filter((r) => !isMissing(r.annualCost));

  const annualCostFrom = costed.reduce((total, r) => total + r.fromFte * r.annualCost, 0);
  const annualCostTo = costed.reduce((total, r) => total + r.toFte * r.annualCost, 0);

  // Saving is stated positive, so the headline reads the way a reader expects even though
  // the underlying delta is negative when cost falls.
  const grossAnnualSaving = annualCostFrom - annualCostTo;
  const grossAnnualSavingWhole = costed.reduce(
    (total, r) => total - r.deltaCostWhole,
    0,
  );

  const fteOut = staffed.reduce((t, r) => t + (r.deltaFte < 0 ? -r.deltaFte : 0), 0);
  const fteIn = staffed.reduce((t, r) => t + (r.deltaFte > 0 ? r.deltaFte : 0), 0);

  /*
   * Redeployment cannot exceed the growth there is to redeploy into. Without that cap a
   * rate of 100% would claim everyone displaced was absorbed even where nothing grew,
   * which would zero the severance on a pure headcount reduction.
   */
  const redeployedFte = Math.min(fteOut * clamp01(block.redeploymentRate), fteIn);
  const exitingFte = fteOut - redeployedFte;
  const unfilledFte = fteIn - redeployedFte;

  // Severance is charged at the cost of the roles actually shrinking, weighted by how
  // much each shrinks — not at an average across every role in the study.
  const severanceCost = params.includeOneTimeCosts
    ? exitingFte *
      weightedCost(costed.filter((r) => r.deltaFte < 0), (r) => -r.deltaFte) *
      (params.severanceWeeks / WEEKS_PER_YEAR)
    : 0;

  const recruitmentCost = params.includeOneTimeCosts
    ? unfilledFte *
      weightedCost(costed.filter((r) => r.deltaFte > 0), (r) => r.deltaFte) *
      block.recruitmentCostPct
    : 0;

  const oneTimeCost = severanceCost + recruitmentCost;

  const uncosted = staffed.filter((r) => isMissing(r.annualCost) && Math.abs(r.deltaFte) > 1e-9);

  return {
    currency: block.currency,
    baseColumn: block.baseColumn,
    targetColumn: block.targetColumn,
    roles,
    annualCostFrom,
    annualCostTo,
    grossAnnualSaving,
    grossAnnualSavingWhole,
    fteOut,
    fteIn,
    netFteChange: comparison.netFteChange,
    exitingFte,
    unfilledFte,
    redeployedFte,
    severanceCost,
    recruitmentCost,
    oneTimeCost,
    // No saving means the cost never comes back, which must read as "never" rather than
    // as a division blowing up or a misleading zero.
    paybackMonths:
      grossAnnualSaving > 0 ? (oneTimeCost / grossAnnualSaving) * 12 : MISSING,
    rolesWithoutCost: uncosted.map((r) => r.label),
    uncostedFteChange: uncosted.reduce((t, r) => t + Math.abs(r.deltaFte), 0),
    comparison,
  };
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** FTE-weighted average annual cost over a set of roles. Zero when the weights are zero. */
const weightedCost = (
  roles: RoleValuation[],
  weight: (r: RoleValuation) => number,
): number => {
  let weightTotal = 0;
  let costTotal = 0;
  for (const role of roles) {
    const w = weight(role);
    if (w <= 0) continue;
    weightTotal += w;
    costTotal += w * role.annualCost;
  }
  return weightTotal === 0 ? 0 : costTotal / weightTotal;
};

/* -------------------------------------------------------------------------- */
/* Where the saving comes from                                               */
/* -------------------------------------------------------------------------- */

export interface SavingSource {
  /** Saving from work moving to a role that costs less per FTE, in the same location. */
  gradeShift: number;
  /** Saving from work moving to a cheaper location. */
  locationShift: number;
  /** Saving from work leaving human capacity entirely. */
  automation: number;
  /** Anything the split cannot attribute, so the parts always tie to the total. */
  unattributed: number;
}

/**
 * Split the annual saving into why it happened.
 *
 * A right-shift can save money three ways and a client will want them separated, because
 * they carry different risk and different owners: a grade change is a job-design decision,
 * a location change is a footprint decision, and automation is a build.
 *
 * Attribution is by where the work landed relative to where it came from, weighted by the
 * minutes that actually moved. `unattributed` exists so the parts always sum to the whole
 * — a decomposition that silently loses a residual is worse than none.
 */
export const savingSources = (
  block: CapacityBlock,
  valuation: CapacityValuation,
): SavingSource => {
  const paramsByRole = new Map(block.roles.map((r) => [r.role, r]));

  // Automation: minutes that moved to an automated role no longer need anyone. Valued at
  // the cost of the roles that gave the work up.
  const automatedGain = valuation.comparison.automatedMinutesGained;
  const shrinking = valuation.roles.filter((r) => !r.automated && !r.unassigned && r.deltaFte < 0);
  const shrinkingCost = weightedCost(
    shrinking.filter((r) => !isMissing(r.annualCost)),
    (r) => -r.deltaFte,
  );

  let automation = 0;
  if (automatedGain > 0 && shrinkingCost > 0) {
    // Convert the automated minutes into the FTE they would have consumed at the
    // giving-up roles' productive rate, then cost them.
    const givers = shrinking
      .map((r) => paramsByRole.get(r.role))
      .filter((r): r is RoleCapacity => r !== undefined && r.workingHoursPerYear > 0);
    const minutesPerFte =
      givers.length === 0
        ? MISSING
        : givers.reduce((t, r) => t + r.workingHoursPerYear * r.utilisationPct * 60, 0) /
          givers.length;
    if (!isMissing(minutesPerFte) && minutesPerFte > 0) {
      automation = (automatedGain / minutesPerFte) * shrinkingCost;
    }
  }

  // Location: for each shrinking role, the share of its released FTE that landed in a
  // different location, valued at the cost difference.
  const growing = valuation.roles.filter((r) => !r.automated && !r.unassigned && r.deltaFte > 0);
  const growthTotal = growing.reduce((t, r) => t + r.deltaFte, 0);

  let locationShift = 0;
  let gradeShift = 0;

  if (growthTotal > 0) {
    for (const shrink of shrinking) {
      if (isMissing(shrink.annualCost)) continue;
      for (const grow of growing) {
        if (isMissing(grow.annualCost)) continue;
        // The work is assumed to spread across growing roles in proportion to how much
        // each grew, which is the only assumption available without a step-level trace.
        const moved = -shrink.deltaFte * (grow.deltaFte / growthTotal);
        const saving = moved * (shrink.annualCost - grow.annualCost);
        if (shrink.location !== grow.location) locationShift += saving;
        else gradeShift += saving;
      }
    }
  }

  return {
    gradeShift,
    locationShift,
    automation,
    unattributed: valuation.grossAnnualSaving - gradeShift - locationShift - automation,
  };
};
