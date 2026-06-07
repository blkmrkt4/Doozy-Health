"use client";

// Calibrated syringe visual (PRD §4.3, §9). Renders a syringe SVG scaled
// to the user's actual syringe spec, showing the fill volume for the
// chosen dose. Not decorative — calibrated to the syringe's real markings.
//
// Drawn HORIZONTALLY and stretched to the container width so the graduation
// numbers are large enough to read on phone and desktop. Plunger on the left,
// needle on the right; 0 sits at the needle end (where the liquid draws to) and
// the scale increases toward the plunger, matching a real syringe.

import { doseToVolumeMl, formatVolumeMl } from "@/lib/units";

const VB_W = 360;
const VB_H = 96;
const BARREL_LEFT = 40; // plunger end (= full capacity)
const BARREL_RIGHT = 322; // needle end (= 0)
const BARREL_TOP = 18;
const BARREL_BOTTOM = 50;
const BARREL_W = BARREL_RIGHT - BARREL_LEFT;
const CENTER_Y = (BARREL_TOP + BARREL_BOTTOM) / 2;

export function SyringeVisual({
  doseAmount,
  concentrationAmount,
  concentrationPerVolume,
  syringeCapacityMl,
}: {
  doseAmount: number;
  concentrationAmount: number;
  concentrationPerVolume: number;
  syringeCapacityMl: number;
}) {
  if (
    !Number.isFinite(doseAmount) ||
    !Number.isFinite(concentrationAmount) ||
    concentrationAmount <= 0 ||
    !Number.isFinite(syringeCapacityMl) ||
    syringeCapacityMl <= 0
  ) {
    return null;
  }

  const volumeMl = doseToVolumeMl(
    doseAmount,
    concentrationAmount,
    concentrationPerVolume
  );

  const fillFraction = Math.min(volumeMl / syringeCapacityMl, 1);
  // 0 at the needle (right), full capacity at the plunger (left).
  const xForFrac = (frac: number) => BARREL_RIGHT - BARREL_W * frac;
  const fillX = xForFrac(fillFraction);

  // Markings at even intervals; label precision follows the step size so a
  // 1 mL syringe reads 0.0–1.0 and a 0.5 mL one reads 0.00–0.50.
  const markCount = syringeCapacityMl <= 1 ? 10 : 5;
  const step = syringeCapacityMl / markCount;
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const markings = Array.from({ length: markCount + 1 }, (_, i) => {
    const frac = i / markCount;
    return {
      x: xForFrac(frac),
      label: (syringeCapacityMl * frac).toFixed(decimals),
    };
  });

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full">
        {/* Plunger thumb rest + rod */}
        <rect x={2} y={CENTER_Y - 13} width={5} height={26} rx={2} fill="var(--color-faint)" />
        <rect x={7} y={CENTER_Y - 2} width={BARREL_LEFT - 7} height={4} rx={2} fill="var(--color-faint)" />
        {/* Barrel finger flange (plunger end) */}
        <rect x={BARREL_LEFT - 3} y={BARREL_TOP - 5} width={3} height={BARREL_BOTTOM - BARREL_TOP + 10} rx={1} fill="var(--color-faint)" />

        {/* Barrel outline */}
        <rect
          x={BARREL_LEFT}
          y={BARREL_TOP}
          width={BARREL_W}
          height={BARREL_BOTTOM - BARREL_TOP}
          rx={3}
          fill="none"
          stroke="var(--color-faint)"
          strokeWidth={1.5}
        />

        {/* Fill level — drawn from the needle (right) to the dose line */}
        <rect
          x={fillX}
          y={BARREL_TOP + 1}
          width={BARREL_RIGHT - fillX}
          height={BARREL_BOTTOM - BARREL_TOP - 2}
          rx={2}
          fill="var(--color-accent)"
          opacity={0.3}
        />
        {/* Fill line (the "fill to this line" indicator) */}
        <line x1={fillX} y1={BARREL_TOP - 2} x2={fillX} y2={BARREL_BOTTOM + 2} stroke="var(--color-accent)" strokeWidth={2.5} />

        {/* Needle */}
        <line x1={BARREL_RIGHT} y1={CENTER_Y} x2={VB_W - 4} y2={CENTER_Y} stroke="var(--color-muted)" strokeWidth={1.5} />
        <circle cx={VB_W - 3} cy={CENTER_Y} r={1.5} fill="var(--color-muted)" />

        {/* Markings + labels */}
        {markings.map((m, i) => (
          <g key={i}>
            <line x1={m.x} y1={BARREL_BOTTOM} x2={m.x} y2={BARREL_BOTTOM + 5} stroke="var(--color-faint)" strokeWidth={0.75} />
            <text
              x={m.x}
              y={BARREL_BOTTOM + 18}
              textAnchor="middle"
              fontSize={11}
              className="tabular fill-muted"
            >
              {m.label}
            </text>
          </g>
        ))}
      </svg>

      <p className="tabular text-sm text-paper">
        {formatVolumeMl(volumeMl, syringeCapacityMl)}
        <span className="ml-2 text-xs text-faint">Fill to the yellow line</span>
      </p>
    </div>
  );
}
