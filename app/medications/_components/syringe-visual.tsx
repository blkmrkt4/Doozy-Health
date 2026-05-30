"use client";

// Calibrated syringe visual (PRD §4.3, §9). Renders a syringe SVG scaled
// to the user's actual syringe spec, showing the fill volume for the
// chosen dose. Not decorative — calibrated to the syringe's real markings.

import { doseToVolumeMl, formatVolumeMl } from "@/lib/units";

const SYRINGE_HEIGHT = 200;
const SYRINGE_WIDTH = 60;
const BARREL_TOP = 30;
const BARREL_BOTTOM = 170;
const BARREL_WIDTH = 30;
const BARREL_LEFT = (SYRINGE_WIDTH - BARREL_WIDTH) / 2;

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
  const barrelHeight = BARREL_BOTTOM - BARREL_TOP;
  const fillHeight = barrelHeight * fillFraction;
  const fillTop = BARREL_BOTTOM - fillHeight;

  // Generate markings at even intervals.
  const markCount = syringeCapacityMl <= 1 ? 10 : 5;
  const markings: { y: number; label: string }[] = [];
  for (let i = 0; i <= markCount; i++) {
    const frac = i / markCount;
    const y = BARREL_BOTTOM - barrelHeight * frac;
    const vol = syringeCapacityMl * frac;
    markings.push({
      y,
      label: syringeCapacityMl <= 1 ? vol.toFixed(2) : vol.toFixed(1),
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${SYRINGE_WIDTH} ${SYRINGE_HEIGHT}`}
        className="h-48 w-16"
      >
        {/* Plunger */}
        <rect
          x={BARREL_LEFT + BARREL_WIDTH / 2 - 2}
          y={4}
          width={4}
          height={BARREL_TOP - 4}
          rx={2}
          fill="#777777"
        />
        <rect
          x={BARREL_LEFT + 2}
          y={BARREL_TOP - 2}
          width={BARREL_WIDTH - 4}
          height={4}
          rx={1}
          fill="#777777"
        />

        {/* Barrel outline */}
        <rect
          x={BARREL_LEFT}
          y={BARREL_TOP}
          width={BARREL_WIDTH}
          height={barrelHeight}
          rx={2}
          fill="none"
          stroke="#262626"
          strokeWidth={1.5}
        />

        {/* Fill level */}
        <rect
          x={BARREL_LEFT + 1}
          y={fillTop}
          width={BARREL_WIDTH - 2}
          height={fillHeight}
          rx={1}
          fill="#F4EE35"
          opacity={0.3}
        />

        {/* Fill line (the "fill to this line" indicator) */}
        <line
          x1={BARREL_LEFT}
          y1={fillTop}
          x2={BARREL_LEFT + BARREL_WIDTH}
          y2={fillTop}
          stroke="#F4EE35"
          strokeWidth={2}
        />

        {/* Markings */}
        {markings.map((m, i) => (
          <g key={i}>
            <line
              x1={BARREL_LEFT + BARREL_WIDTH}
              y1={m.y}
              x2={BARREL_LEFT + BARREL_WIDTH + 6}
              y2={m.y}
              stroke="#555555"
              strokeWidth={0.5}
            />
            <text
              x={BARREL_LEFT + BARREL_WIDTH + 8}
              y={m.y + 3}
              className="fill-faint text-[7px]"
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* Needle */}
        <line
          x1={SYRINGE_WIDTH / 2}
          y1={BARREL_BOTTOM}
          x2={SYRINGE_WIDTH / 2}
          y2={SYRINGE_HEIGHT - 4}
          stroke="#cccccc"
          strokeWidth={1}
        />
        <circle
          cx={SYRINGE_WIDTH / 2}
          cy={SYRINGE_HEIGHT - 3}
          r={1}
          fill="#cccccc"
        />
      </svg>

      <p className="tabular text-center text-sm text-paper">
        {formatVolumeMl(volumeMl, syringeCapacityMl)}
      </p>
      <p className="text-center text-xs text-faint">
        Fill to the yellow line
      </p>
    </div>
  );
}
