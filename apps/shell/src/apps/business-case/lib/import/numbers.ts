/**
 * Reading a number out of a spreadsheet cell.
 *
 * Every rule here exists because a real export breaks the naive `Number(raw)`, and
 * each failure is silent: `Number("(1,234)")` is NaN, `Number("1.234,56")` is NaN,
 * `Number("1 880")` with a non-breaking space is NaN. A NaN that becomes 0 somewhere
 * downstream is the whole class of bug this module exists to prevent.
 *
 * Where a value is genuinely ambiguous the parser does NOT guess quietly — it returns
 * a note alongside the value so the import report can show it and the user can decide.
 */

export interface ParsedNumber {
  value: number | null;
  /** Set when the value was accepted but something about it deserves a second look. */
  note?: string;
}

const CURRENCY = /[$£€¥₹]/g;
/** Space, non-breaking space, narrow no-break space, thin space — all used as separators. */
const SPACES = /[\s   ']/g;

/**
 * What a single separator followed by exactly three digits should mean.
 *
 * "1.234" is genuinely ambiguous — 1234 in a European export, one-point-two-three-four
 * anywhere else — and no amount of string inspection resolves it. The caller knows
 * which column it is reading, and that is the information that settles it: a handle
 * time of 1.234 minutes is ordinary, a volume of 1.234 is not.
 */
export type GroupingHint = "thousands" | "decimal";

interface SeparatorResult {
  text: string;
  /** Set when the hint was what decided the answer, so the caller can surface it. */
  ambiguous: boolean;
}

/**
 * Decide which of `.` and `,` is the decimal separator.
 *
 * With both present the answer is positional and certain: whichever comes last is the
 * decimal point, so "1.234,56" and "1,234.56" both read as 1234.56 without needing to
 * know the file's locale.
 *
 * With only one present it depends on the grouping. A separator followed by exactly
 * three digits, with digits before it, is a thousands separator in every English
 * export and a decimal comma in half of Europe — that case defers to the hint.
 */
const normaliseSeparators = (text: string, hint: GroupingHint): SeparatorResult => {
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  if (lastDot === -1 && lastComma === -1) return { text, ambiguous: false };

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      return { text: text.replace(/\./g, "").replace(",", "."), ambiguous: false };
    }
    return { text: text.replace(/,/g, ""), ambiguous: false };
  }

  const separator = lastDot !== -1 ? "." : ",";
  const parts = text.split(separator);
  const tail = parts[parts.length - 1]!;
  const head = parts.slice(0, -1).join("");

  // Several groups can only be thousands: "1,234,567" is not a number with two
  // decimal points.
  const multipleGroups = parts.length > 2;
  const looksGrouped = tail.length === 3 && head.length > 0;

  if (multipleGroups) {
    return { text: parts.join(""), ambiguous: false };
  }

  if (!looksGrouped) {
    // Anything other than exactly three trailing digits is a decimal separator:
    // "18,5" and "0.0059" are not grouped thousands.
    return { text: `${head}.${tail}`, ambiguous: false };
  }

  // Reported as ambiguous only for a dot. "1.234" really does appear as both 1234 and
  // 1.234 in files this will see. A decimal comma with exactly three places ("1,234"
  // meaning 1.234) is rare — European decimals are almost always two places — so
  // flagging every English "1,234" would be noise, and a report full of noise is a
  // report the user stops reading.
  const ambiguous = separator === ".";

  return hint === "thousands"
    ? { text: parts.join(""), ambiguous }
    : { text: `${head}.${tail}`, ambiguous };
};

/** Trailing magnitude suffixes, as they appear in hand-built summary sheets. */
const SUFFIXES: Array<{ pattern: RegExp; factor: number; label: string }> = [
  { pattern: /(bn|b)$/i, factor: 1e9, label: "billions" },
  { pattern: /(m|mm)$/i, factor: 1e6, label: "millions" },
  { pattern: /k$/i, factor: 1e3, label: "thousands" },
];

/** `m:ss` or `h:mm:ss`, as a count of minutes. */
const parseClock = (text: string): ParsedNumber | null => {
  const match = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
  if (!match) return null;

  const [, a, b, c] = match;
  if (c !== undefined) {
    // Three parts is unambiguous: h:mm:ss.
    return { value: Number(a) * 60 + Number(b) + Number(c) / 60 };
  }
  // Two parts is not. In a handle-time column "8:30" is far more likely to be eight
  // and a half minutes than eight and a half hours, but it is a guess and is labelled
  // as one rather than being applied silently.
  return {
    value: Number(a) + Number(b) / 60,
    note: `read "${text}" as ${a} min ${b} sec`,
  };
};

export const parseCellNumber = (
  raw: string,
  { grouping = "thousands" }: { grouping?: GroupingHint } = {},
): ParsedNumber => {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return { value: null };

  const clock = parseClock(trimmed);
  if (clock) return clock;

  // Accounting negatives. Detected before stripping, because the parentheses ARE the
  // minus sign and there will be no other.
  const parenthesised = /^\((.*)\)$/.exec(trimmed);
  const body = parenthesised ? parenthesised[1]! : trimmed;

  let cleaned = body.replace(CURRENCY, "").replace(SPACES, "").replace(/%$/, "");

  let factor = 1;
  let suffixNote: string | undefined;
  for (const suffix of SUFFIXES) {
    if (suffix.pattern.test(cleaned)) {
      // Only when what remains is actually numeric, so a task called "Bulk" is not
      // read as a number in thousands.
      const stem = cleaned.replace(suffix.pattern, "");
      if (stem !== "" && /^[-+]?[\d.,]+$/.test(stem)) {
        cleaned = stem;
        factor = suffix.factor;
        suffixNote = `read the suffix as ${suffix.label}`;
      }
      break;
    }
  }

  const separated = normaliseSeparators(cleaned, grouping);
  cleaned = separated.text;

  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return { value: null };

  const parsed = Number(cleaned) * factor;
  if (!Number.isFinite(parsed)) return { value: null };

  const value = parenthesised ? -parsed : parsed;

  const notes = [
    suffixNote,
    separated.ambiguous
      ? `"${trimmed}" could be read either way — taken as ${grouping === "thousands" ? "a thousands separator" : "a decimal point"}`
      : undefined,
  ].filter((n): n is string => n !== undefined);

  return notes.length > 0 ? { value, note: notes.join("; ") } : { value };
};

/**
 * A cell that Excel stored as a time-of-day.
 *
 * Excel keeps times as a fraction of a day, so a cell formatted 00:08:30 arrives as
 * 0.0059. In a minutes column that is three orders of magnitude out, and it is not
 * safely distinguishable from a genuine sub-minute task — so it is flagged, never
 * converted.
 */
export const looksLikeTimeSerial = (value: number): boolean => value > 0 && value < 1;
