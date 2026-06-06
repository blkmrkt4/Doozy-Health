// Medication identity + adherence status colours (PRD §9, §6.1). The app's
// palette is deliberately neutral (monochrome on black) SO THAT purposeful
// colour earns the eye. The two sanctioned uses of saturated colour are:
//   1. per-medication identity — a distinct, stable hue per drug, so dots can
//      be told apart at a glance (like a legend);
//   2. adherence status — the calendar's factual record of logged-vs-scheduled
//      doses (full / partial / missed).
// Red and green are RESERVED for adherence status and never assigned as a
// medication identity colour, so a drug dot can never be confused with a
// warning or a "done" signal.

/** Curated medication identity palette — bold, distinct, readable on black,
 *  excluding red/green/orange (reserved for adherence status) and accent
 *  yellow (reserved for today/selection). Assignment is stable per medication. */
// Vivid, saturated identity colours (the "RIZE" palette) — bold enough to read
// at a glance as small dots on black. Ordered for maximum separation between
// *consecutive* hues, since colours are assigned round-robin (the first few
// medications a patient adds get the most distinct colours). These are identity
// only; the adherence status layer (green/orange/red) is a separate set below.
export const MED_PALETTE = [
  "#3AAFFF", // electric ice (blue)
  "#FF32FF", // magenta
  "#B400FF", // purple
  "#32FFFF", // teal
  "#FF5F3A", // hot coral
  "#B4FF00", // lime
  "#6BBF8A", // cedar sage
] as const;

export type MedColour = (typeof MED_PALETTE)[number];

/** Adherence status colours for the legend. The day cell itself is coloured by
 *  `complianceColour(ratio)` below — a smooth red→yellow→sage→green blend.
 *  These are a factual record of what was logged, never an instruction. */
export const COMPLIANCE_COLOURS = {
  none: "transparent", // nothing due — neutral on the black base
  full: "#34D058", // green — all due doses logged as chosen
  nearly: "#86C99A", // sage — nearly everything
  partial: "#FFD60A", // yellow — about half
  missed: "#FF3C00", // red — due, but none logged (past days only)
} as const;

export type ComplianceStatus = keyof typeof COMPLIANCE_COLOURS;

// Colour ramp for the day grade. Full opacity at every point (no alpha fade →
// no muddiness); the ratio (taken-in-full ÷ due) picks a point on the blend.
const COMPLIANCE_RAMP: { at: number; rgb: [number, number, number] }[] = [
  { at: 0.0, rgb: [0xff, 0x3c, 0x00] }, // red — nothing taken
  { at: 0.5, rgb: [0xff, 0xd6, 0x0a] }, // yellow — about half
  { at: 0.8, rgb: [0x86, 0xc9, 0x9a] }, // sage — nearly everything
  { at: 1.0, rgb: [0x34, 0xd0, 0x58] }, // green — all taken in full
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function toHex([r, g, b]: [number, number, number]): string {
  return (
    "#" +
    [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/**
 * Map a completeness ratio (0..1) to a full-opacity hex on the
 * red→yellow→sage→green blend. 1 → green, 0.8 → sage, 0.5 → yellow, 0 → red.
 */
export function complianceColour(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  for (let i = 1; i < COMPLIANCE_RAMP.length; i++) {
    const hi = COMPLIANCE_RAMP[i];
    if (r <= hi.at) {
      const lo = COMPLIANCE_RAMP[i - 1];
      const span = hi.at - lo.at || 1;
      const t = (r - lo.at) / span;
      return toHex([
        lerp(lo.rgb[0], hi.rgb[0], t),
        lerp(lo.rgb[1], hi.rgb[1], t),
        lerp(lo.rgb[2], hi.rgb[2], t),
      ]);
    }
  }
  return toHex(COMPLIANCE_RAMP[COMPLIANCE_RAMP.length - 1].rgb);
}

/**
 * Pick the next distinct identity colour for a medication, given the colours
 * already in use by the patient's other medications. Falls back to a
 * deterministic wrap once the palette is exhausted (cosmetic; collisions past
 * the palette size are acceptable).
 */
export function nextMedColour(usedColours: readonly (string | null)[]): MedColour {
  const used = new Set(
    usedColours.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase())
  );
  const free = MED_PALETTE.find((c) => !used.has(c.toLowerCase()));
  return free ?? MED_PALETTE[used.size % MED_PALETTE.length];
}
