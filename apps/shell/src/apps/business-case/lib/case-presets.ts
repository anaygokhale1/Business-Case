/**
 * Industry presets.
 *
 * A preset is a set of suggestions, never an answer. Everything it fills in is editable
 * and is reported as a preset in the questionnaire, for the same reason a benchmark salary
 * is: a figure the app supplied and the client never looked at must not end up defended as
 * theirs.
 *
 * The insurance preset comes from a real right-shift engagement's shape — the process
 * taxonomy depth, the transaction and outcome vocabulary, and the role grades an
 * underwriting operation is organised around. The SHAPE is transferable across carriers;
 * the figures were not, and none are carried here.
 */

import type { CaseModel } from "./engine/types";

export interface CapacityPreset {
  id: string;
  label: string;
  /** Industries this preset is offered for, matched against `meta.industry`. */
  industries: string[];
  /** One line on what selecting it does. */
  blurb: string;
  model: CaseModel;
  /** Transaction types a study is expected to distinguish. */
  transactionTypes: string[];
  /** Final outcomes, in the order they should be presented. */
  statuses: string[];
  /** Typical lines of business, offered as a starting list. */
  lobs: string[];
  /**
   * Role grades, with the location and kind each usually carries.
   *
   * Costs are deliberately absent. There is no defensible industry figure for an
   * underwriter's all-in cost — it moves by country, carrier and line — and a plausible
   * number here would be the most quietly damaging thing in the file.
   */
  roles: Array<{
    role: string;
    /** What the abbreviation means, so a reader who does not know it is not stuck. */
    description: string;
    location: string;
    kind: "staffed" | "automated" | "unassigned";
  }>;
  /** Which file layout to hand the client. */
  templateFiles: string[];
}

export const INSURANCE_CAPACITY_PRESET: CapacityPreset = {
  id: "insurance-right-shift",
  label: "Insurance right-shift",
  industries: ["Insurance / Reinsurance"],
  blurb:
    "A process time study several levels deep, owned role by role, with volumes by line of business and transaction type. Capacity is computed per role and the opportunity is work moving to a different grade or location rather than a percentage cut.",
  model: "capacity",
  // A submission is new, a renewal or a mid-term change, and it ends bound, lost or
  // declined. All three outcomes consume work, which is why the volume template asks for
  // transactions received rather than policies written.
  transactionTypes: ["New", "Renewal", "Endorsement"],
  statuses: ["Bound", "Lost", "Declined"],
  lobs: ["Property", "Casualty", "Financial Lines"],
  roles: [
    { role: "UW", description: "Underwriter", location: "Onshore", kind: "staffed" },
    { role: "UA", description: "Underwriting assistant", location: "Onshore", kind: "staffed" },
    { role: "SSC", description: "Shared service centre", location: "Hub", kind: "staffed" },
    { role: "COE", description: "Centre of excellence", location: "Hub", kind: "staffed" },
    { role: "PAD", description: "Portfolio and data", location: "Onshore", kind: "staffed" },
    { role: "Collections", description: "Credit control and collections", location: "Hub", kind: "staffed" },
    { role: "Engineering", description: "Risk engineering", location: "Onshore", kind: "staffed" },
    { role: "System", description: "Straight-through processing", location: "", kind: "automated" },
  ],
  templateFiles: ["capacity-study-template.csv", "capacity-volumes-template.csv"],
};

export const CAPACITY_PRESETS: readonly CapacityPreset[] = [INSURANCE_CAPACITY_PRESET];

/** The preset offered for an industry, if any. */
export const presetForIndustry = (industry: string): CapacityPreset | null =>
  CAPACITY_PRESETS.find((preset) => preset.industries.includes(industry.trim())) ?? null;

/** Location list a preset implies, for the cost table's dropdown. */
export const presetLocations = (preset: CapacityPreset): string[] => {
  const seen: string[] = [];
  for (const role of preset.roles) {
    if (role.location !== "" && !seen.includes(role.location)) seen.push(role.location);
  }
  return seen;
};
