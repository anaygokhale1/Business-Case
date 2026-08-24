/**
 * Matching spreadsheet headers to fields.
 *
 * The vocabulary is per-import — a volume sheet's headers and a process study's headers
 * have almost nothing in common, and scoring one against the other's aliases picks
 * whichever column happens to contain a stray matching word. So each import owns its
 * alias table; only the scoring rules are shared, and they are shared because the two
 * rules that matter are easy to get wrong in isolation:
 *
 *  - Parenthesised qualifiers are stripped. "Volume (FY25)" and "Volume" are the same
 *    column, and a client who documents the period in the header should not thereby
 *    lose the match.
 *  - A partial match needs at least three characters on both sides. Without the floor,
 *    a column headed "C" scores against "count", "cases" and "country" at once, and
 *    the winner is whichever alias table happened to list it first.
 */

/** Lowercase, drop parenthesised qualifiers, keep only alphanumerics. */
export const normaliseHeader = (header: string): string =>
  header
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

/** 100 exact, 70 prefix, 50 contained, 0 no match. Absolute values only matter as an order. */
export const scoreAgainstAliases = (header: string, aliases: readonly string[]): number => {
  const norm = normaliseHeader(header);
  if (norm === "") return 0;
  let best = 0;
  for (const alias of aliases) {
    const target = normaliseHeader(alias);
    if (norm === target) {
      best = Math.max(best, 100);
      continue;
    }
    if (Math.min(norm.length, target.length) < 3) continue;
    if (norm.startsWith(target) || target.startsWith(norm)) best = Math.max(best, 70);
    else if (norm.includes(target)) best = Math.max(best, 50);
  }
  return best;
};

/**
 * Assign each field its best unclaimed column.
 *
 * Highest score first across the whole grid rather than field by field, so a column that
 * two fields both want goes to the one it matches better. Ties break on column order,
 * which makes the proposal deterministic — a mapping that moved between two reads of the
 * same file would be impossible to review.
 */
export const assignColumns = <F extends string>(
  header: string[],
  aliases: Record<F, readonly string[]>,
  fields: readonly F[],
): Record<F, number | null> => {
  const candidates: Array<{ field: F; column: number; score: number }> = [];
  header.forEach((cell, column) => {
    for (const field of fields) {
      const score = scoreAgainstAliases(cell, aliases[field]);
      if (score > 0) candidates.push({ field, column, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping = Object.fromEntries(fields.map((f) => [f, null])) as Record<F, number | null>;
  const used = new Set<number>();
  for (const candidate of candidates) {
    if (mapping[candidate.field] !== null) continue;
    if (used.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    used.add(candidate.column);
  }
  return mapping;
};
