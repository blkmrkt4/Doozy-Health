"use client";

import type { PkTimeSeries } from "@/lib/pharmacokinetics";

// Pure SVG pharmacokinetic chart (PRD §5.7, §9). v0.4: uncertainty band,
// metabolite series, steady-state marker, non-linear panel.
// No charting library — avoids dependency (CLAUDE.md rule #13).
// Never alarmist: no red zones, no "dose now" prompts.

const CHART_HEIGHT = 260;
const PADDING = { top: 20, right: 16, bottom: 40, left: 48 };

// Metabolite colours (muted, distinct from the primary white line).
const METABOLITE_COLOURS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#ec4899"];

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function NonLinearPanel({ reason }: { reason?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-6 text-center space-y-3">
      <p className="text-sm font-medium text-paper">
        This medication doesn&rsquo;t follow simple curve maths
      </p>
      <p className="text-xs text-muted">
        {reason ??
          "Its elimination is non-linear, so a modelled level would mislead."}
      </p>
      <p className="text-xs text-faint">
        Track your doses and discuss levels with your clinician.
      </p>
    </div>
  );
}

export function PkChart({
  series,
  overlay,
  width = 720,
}: {
  series: PkTimeSeries;
  overlay?: PkTimeSeries;
  width?: number;
}) {
  if (series.points.length < 2) {
    return <p className="text-sm text-faint">Not enough data to chart.</p>;
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const tMin = series.points[0].timestamp;
  const tMax = series.points[series.points.length - 1].timestamp;
  const tRange = tMax - tMin;

  // Concentration range — include overlay, uncertainty band, metabolites.
  let cMax = 0;
  const allSeries = [series.points];
  if (series.upperBound) allSeries.push(series.upperBound);
  if (overlay) allSeries.push(overlay.points);
  if (series.metaboliteSeries) {
    for (const ms of series.metaboliteSeries) allSeries.push(ms.points);
  }
  for (const pts of allSeries) {
    for (const p of pts) {
      if (p.concentration > cMax) cMax = p.concentration;
    }
  }
  if (cMax === 0) cMax = 1;

  const x = (t: number) => PADDING.left + ((t - tMin) / tRange) * innerW;
  const y = (c: number) => PADDING.top + innerH - (c / cMax) * innerH;

  function pathD(pts: { timestamp: number; concentration: number }[]): string {
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.timestamp).toFixed(1)} ${y(p.concentration).toFixed(1)}`)
      .join(" ");
  }

  // Uncertainty band area path (upper bound forward, lower bound reverse).
  function bandPath(): string | null {
    if (!series.upperBound || !series.lowerBound) return null;
    const upper = series.upperBound.map(
      (p) => `${x(p.timestamp).toFixed(1)},${y(p.concentration).toFixed(1)}`
    );
    const lower = [...series.lowerBound].reverse().map(
      (p) => `${x(p.timestamp).toFixed(1)},${y(p.concentration).toFixed(1)}`
    );
    return `M ${upper.join(" L ")} L ${lower.join(" L ")} Z`;
  }

  const dayMs = 24 * 3_600_000;
  const firstDay = Math.ceil(tMin / dayMs) * dayMs;
  const ticks: number[] = [];
  for (let t = firstDay; t <= tMax; t += dayMs) ticks.push(t);

  const nowPoint = series.points[series.nowIndex];
  const band = bandPath();

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="w-full" style={{ minWidth: width }}>
        <rect width={width} height={CHART_HEIGHT} fill="transparent" />

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line key={frac} x1={PADDING.left} y1={y(cMax * frac)} x2={width - PADDING.right} y2={y(cMax * frac)} stroke="#262626" strokeDasharray="4 4" />
        ))}

        {/* X axis */}
        <line x1={PADDING.left} y1={PADDING.top + innerH} x2={width - PADDING.right} y2={PADDING.top + innerH} stroke="#262626" />

        {/* X-axis labels */}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={PADDING.top + innerH + 16} textAnchor="middle" className="fill-faint text-[9px]">
            {formatDay(t)}
          </text>
        ))}

        {/* Uncertainty band */}
        {band ? (
          <path d={band} fill="#ffffff" opacity="0.06" />
        ) : null}

        {/* Overlay series (prescribed regimen) */}
        {overlay && overlay.points.length > 1 ? (
          <path d={pathD(overlay.points)} fill="none" stroke="#777777" strokeWidth="1" strokeDasharray="4 2" opacity="0.5" />
        ) : null}

        {/* Metabolite series */}
        {series.metaboliteSeries?.map((ms, i) => (
          <path key={ms.name} d={pathD(ms.points)} fill="none" stroke={METABOLITE_COLOURS[i % METABOLITE_COLOURS.length]} strokeWidth="1" opacity="0.7" />
        ))}

        {/* Primary series */}
        <path d={pathD(series.points)} fill="none" stroke="#ffffff" strokeWidth="1.5" />

        {/* Dose markers */}
        {series.doseMarkers.map((d, i) => (
          <g key={i}>
            <line x1={x(d.timestamp)} y1={PADDING.top} x2={x(d.timestamp)} y2={PADDING.top + innerH} stroke="#F4EE35" strokeWidth="1" opacity="0.4" />
            <circle cx={x(d.timestamp)} cy={PADDING.top + innerH} r="3" fill="#F4EE35" />
          </g>
        ))}

        {/* Steady-state marker */}
        {series.steadyStateTimestamp ? (
          <g>
            <line x1={x(series.steadyStateTimestamp)} y1={PADDING.top} x2={x(series.steadyStateTimestamp)} y2={PADDING.top + innerH} stroke="#cccccc" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
            <text x={x(series.steadyStateTimestamp)} y={PADDING.top + innerH + 28} textAnchor="middle" className="fill-faint text-[7px]">
              ~steady state
            </text>
          </g>
        ) : null}

        {/* "You are here" line */}
        {nowPoint ? (
          <g>
            <line x1={x(nowPoint.timestamp)} y1={PADDING.top} x2={x(nowPoint.timestamp)} y2={PADDING.top + innerH} stroke="#ffffff" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
            <text x={x(nowPoint.timestamp)} y={PADDING.top - 6} textAnchor="middle" className="fill-muted text-[8px]">now</text>
          </g>
        ) : null}

        {/* Projected trough */}
        {series.projectedTrough && series.projectedTrough.timestamp > nowPoint.timestamp ? (
          <g>
            <circle cx={x(series.projectedTrough.timestamp)} cy={y(series.projectedTrough.concentration)} r="3" fill="none" stroke="#cccccc" strokeWidth="1" />
            <text x={x(series.projectedTrough.timestamp) + 6} y={y(series.projectedTrough.concentration) + 3} className="fill-faint text-[8px]">trough</text>
          </g>
        ) : null}

        {/* Y axis label */}
        <text x={10} y={PADDING.top + innerH / 2} textAnchor="middle" transform={`rotate(-90, 10, ${PADDING.top + innerH / 2})`} className="fill-faint text-[8px]">
          relative level
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 bg-white" /> actual
        </span>
        {overlay ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-faint" /> prescribed
          </span>
        ) : null}
        {series.upperBound ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-4 rounded-sm bg-white/10" /> uncertainty
          </span>
        ) : null}
        {series.metaboliteSeries?.map((ms, i) => (
          <span key={ms.name} className="flex items-center gap-1">
            <span className="inline-block h-px w-4" style={{ background: METABOLITE_COLOURS[i % METABOLITE_COLOURS.length] }} />
            {ms.name}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" /> dose
        </span>
      </div>
    </div>
  );
}
