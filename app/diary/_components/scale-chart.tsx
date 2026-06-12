"use client";

import { useState } from "react";

// Combined 1–10 scale chart (PRD §5.9). All of a patient's scale_1_10 measures
// share one time axis so movements line up and correlations are visible. Tapping
// a measure toggles its line; the average and median (always to one decimal) and
// range stay on screen regardless. A factual record of what was logged — no
// advice, no red zones. Series use distinct identity colours; axes/grid use the
// theme tokens so the chart adapts to light/dark. American English.

export type ScaleSeries = {
  id: string;
  name: string;
  points: { date: string; value: number }[];
  avg: number;
  median: number;
  min: number;
  max: number;
};

// Distinct, non-alarmist palette (no alarm-red). Assigned by order.
const PALETTE = [
  "#f4ee35", // accent yellow
  "#6fb1ff", // sky
  "#7ad0a8", // green
  "#c9a0ff", // lavender
  "#f0a55e", // amber
  "#ff8fab", // pink
  "#5ec8c8", // teal
  "#b8b8b8", // grey
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""}`;
}

const one = (n: number) => n.toFixed(1);

export function ScaleChart({ fields }: { fields: ScaleSeries[] }) {
  const [on, setOn] = useState<boolean[]>(() => fields.map(() => true));
  const color = (i: number) => PALETTE[i % PALETTE.length];

  // Shared time axis across every series' points.
  const allTs = fields.flatMap((f) =>
    f.points.map((p) => Date.parse(`${p.date}T12:00:00`))
  );
  const tMin = Math.min(...allTs);
  const tMax = Math.max(...allTs);
  const tRange = tMax - tMin || 1;

  const W = 680;
  const H = 300;
  const padL = 28;
  const padR = 14;
  const padT = 14;
  const padB = 26;

  const x = (iso: string) =>
    padL + ((Date.parse(`${iso}T12:00:00`) - tMin) / tRange) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - 1) / 9) * (H - padT - padB);

  const xLabelDates = (() => {
    const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
    return [isoOf(tMin), isoOf(tMin + tRange / 2), isoOf(tMax)];
  })();

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} role="img"
        aria-label="Combined chart of your 1 to 10 scale measures over time">
        {/* Y gridlines + labels (2,4,6,8,10) */}
        {[2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-faint" fontSize="10">
              {v}
            </text>
          </g>
        ))}

        {/* X date labels */}
        {xLabelDates.map((iso, k) => (
          <text
            key={k}
            x={x(iso)}
            y={H - 8}
            textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
            className="fill-faint"
            fontSize="10"
          >
            {shortDate(iso)}
          </text>
        ))}

        {/* Series lines (only the toggled-on ones) */}
        {fields.map((f, i) => {
          if (!on[i] || f.points.length === 0) return null;
          const c = color(i);
          const d = f.points
            .map((p, j) => `${j === 0 ? "M" : "L"} ${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`)
            .join(" ");
          const last = f.points[f.points.length - 1];
          return (
            <g key={f.id}>
              {f.points.length > 1 ? (
                <path d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" opacity="0.95" />
              ) : null}
              <circle cx={x(last.date)} cy={y(last.value)} r="3" fill={c} />
            </g>
          );
        })}
      </svg>

      {/* Legend — tap to toggle a line; shows avg / median inline */}
      <div className="mt-3 flex flex-wrap gap-2">
        {fields.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOn((prev) => prev.map((v, j) => (j === i ? !v : v)))}
            aria-pressed={on[i]}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-opacity ${
              on[i] ? "border-line text-muted" : "border-line text-faint opacity-40"
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: on[i] ? color(i) : "var(--color-faint)" }}
            />
            {f.name}
            <span className="text-faint tabular">
              {one(f.avg)} / {one(f.median)}
            </span>
          </button>
        ))}
      </div>

      {/* Always-on numeric stats (avg / median to one decimal + range) */}
      <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {fields.map((f, i) => (
          <div
            key={f.id}
            className="flex items-center gap-2 border-t border-line py-1.5 text-xs"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(i) }} />
            <span className="flex-1 text-muted">{f.name}</span>
            <span className="tabular text-faint">
              avg <b className="font-semibold text-accent">{one(f.avg)}</b> · med{" "}
              <b className="font-semibold text-accent">{one(f.median)}</b> · range{" "}
              <b className="font-semibold text-paper">
                {f.min}–{f.max}
              </b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
