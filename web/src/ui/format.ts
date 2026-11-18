// Shared tonnage/number formatting (Roadmap V3 Phase 1, backlog item 4).
// Extracted from the duplicated formatting idioms in the five slice browser mains
// (.toFixed(1/2) + ' t', .toFixed(0)). Theme-agnostic, no per-slice imports.
// NOTE: presentation rounding only — NEVER use these for simulation math; sim ports
// keep their own pyRound (banker's rounding) semantics.

/** Tonnage with fixed decimals and the ' t' suffix, e.g. 1234.5 -> "1234.5 t". */
export function formatTons(value: number, digits = 1): string {
  return `${value.toFixed(digits)} t`;
}

/** Compact tonnage for HUD rows (no space), e.g. 480 -> "480t". */
export function tonsCompact(value: number, digits = 0): string {
  return `${Number.isInteger(value) ? value.toFixed(digits === 0 ? 0 : digits) : value.toFixed(digits)}t`;
}

/** Plain fixed-decimal number (no unit), e.g. money or percentages. */
export function formatNum(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** USD with thousands separators and no decimals, e.g. 123456 -> "$123,456". */
export function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
