/**
 * Colours for the charts.
 *
 * Held here rather than in each chart so the current/target pair means the same thing on
 * every screen. A reader who learns that blue is "today" on one card must not find it
 * meaning something else on the next.
 *
 * The brand tokens are the chrome's, and they fail as data marks: `ink` #00346f sits below
 * the lightness band a mark needs to read against the surface, and `teal` #006b5c below the
 * chroma floor, so it renders as grey. These are steps of the same two hues, lightened and
 * given chroma until the palette passes — validated, not chosen by eye:
 *
 *   categorical pair  lightness band PASS · chroma floor PASS · CVD separation deutan
 *                     ΔE 16.9 / tritan 8.1 · normal-vision ΔE 18.2 · contrast >= 3:1
 *   sequential ramp   lightness monotone PASS · adjacent ΔL >= 0.06 PASS ·
 *                     light-end contrast 2.10:1 PASS · single hue, 2° spread PASS
 *
 * Identity never rests on colour alone anywhere these are used: there is a legend, the
 * series keep a fixed order, and every value is printed.
 */

/** The as-is state. A mid step of the brand's ink blue. */
export const SERIES_CURRENT = "#3a6fc4";

/** The to-be state. A brighter step of the brand's teal. */
export const SERIES_TARGET = "#0f9b86";

/**
 * Magnitude, light to dark, one hue.
 *
 * Five steps: enough to read a gradient, few enough that a reader can tell two adjacent
 * cells apart. The light end is deliberately not near-white — it has to clear the surface
 * it sits on, or the smallest value becomes invisible rather than small.
 */
export const SAVING_RAMP = ["#66c0b0", "#33a897", "#158b7c", "#0b6a5e", "#05493f"] as const;

/** Where a value sits on the ramp. `share` is 0 at nothing and 1 at the largest in view. */
export const rampIndex = (share: number): number => {
  if (!Number.isFinite(share) || share <= 0) return 0;
  const index = Math.floor(share * SAVING_RAMP.length);
  return Math.min(SAVING_RAMP.length - 1, index);
};

export const rampFill = (share: number): string => SAVING_RAMP[rampIndex(share)]!;

/**
 * Text colour for a label set inside a ramp cell.
 *
 * The one place a value does not wear a text token: on the darker steps an ink label is
 * unreadable, so it flips to white. Chosen by step rather than by measuring each pair at
 * render time, because the ramp is fixed and the switch point is not a judgement call.
 */
export const rampInk = (share: number): string => (rampIndex(share) >= 2 ? "#ffffff" : "#062e28");
