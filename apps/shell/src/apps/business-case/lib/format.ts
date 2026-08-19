/**
 * Display formatting.
 *
 * Every formatter renders the sentinel as "n/a" rather than as 0. A missing input
 * showing as zero is the failure the engine's sentinel exists to prevent, and it
 * would be undone here if these quietly coerced.
 */

import { isMissing } from "./engine/alg";

const NA = "n/a";

export const currency = (value: number): string => {
  if (isMissing(value)) return NA;
  const rounded = Math.round(value);
  const body = Math.abs(rounded).toLocaleString("en-US");
  // Accounting style: parentheses for negatives, matching the skill's number format
  // and how a finance reader expects to see a cost.
  return rounded < 0 ? `($${body})` : `$${body}`;
};

export const currencyCompact = (value: number): string => {
  if (isMissing(value)) return NA;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

export const fte = (value: number, dp = 1): string =>
  isMissing(value) ? NA : value.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const count = (value: number): string =>
  isMissing(value) ? NA : Math.round(value).toLocaleString("en-US");

export const pct = (value: number, dp = 1): string =>
  isMissing(value) ? NA : `${(value * 100).toFixed(dp)}%`;

export const minutes = (value: number): string =>
  isMissing(value) ? NA : `${value.toFixed(1)}`;

/** Payback reads as "never" rather than "n/a": the cost is real, the return is not. */
export const months = (value: number): string =>
  isMissing(value) ? "never" : `${value.toFixed(1)} mo`;
