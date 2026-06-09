"use client";

import type { PkTimeSeries } from "@/lib/pharmacokinetics";

// Pure SVG pharmacokinetic chart (PRD §5.7, §9). Axes, weekly date labels, a
// "now" divider, dose markers, the chosen-schedule overlay, uncertainty band and
// metabolites. No charting library (rule #13). Never alarmist: no red zones, no
// "dose now". Y-axis is an illustrative *relative* level, never an absolute
// concentration (§6.1).

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
  height = 260,
  showLegend = true,
  provenance,
}: {
  series: PkTimeSeries;
  overlay?: PkTimeSeries;
  width?: number;
  height?: number;
  showLegend?: boolean;
  /** when "llm_estimated", note the half-life was AI looked-up (PRD §5.7/§6.1) */
  provenance?: "curated" | "llm_extracted" | "llm_estimated" | "user_calibrated";
}) {
  if (series.points.length < 2) {
    return <p className="text-sm text-faint">Not enough data to chart.</p>;
  }

  const PADDING = { top: 18, right: 14, bottom: 34, left: 44 };
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const tMin = series.points[0].timestamp;
  const tMax = series.points[series.points.length - 1].timestamp;
  const tRange = tMax - tMin || 1;

  // Concentration range — include overlay, uncertainty band, metabolites.
  let cMax = 0;
  const allSeries = [series.points];
  if (series.upperBound) allSeries.push(series.upperBound);
  if (overlay) allSeries.push(overlay.points);
  if (series.metaboliteSeries) {
    for (const ms of series.metaboliteSeries) allSeries.push(ms.points);
  }
  for (const pts of allSeries) {
    for (const p of pts) if (p.concentration > cMax) cMax = p.concentration;
  }
  if (cMax === 0) cMax = 1;

  const x = (t: number) => PADDING.left + ((t - tMin) / tRange) * innerW;
  const y = (c: number) => PADDING.top + innerH - (c / cMax) * innerH;
  const baseY = PADDING.top + innerH;

  function pathD(pts: { timestamp: number; concentration: number }[]): string {
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.timestamp).toFixed(1)} ${y(p.concentration).toFixed(1)}`)
      .join(" ");
  }

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

  // Weekly date ticks (a tick per day is unreadable over a 6-week window).
  const dayMs = 24 * 3_600_000;
  const weekMs = 7 * dayMs;
  const firstTick = Math.ceil(tMin / dayMs) * dayMs;
  const ticks: number[] = [];
  for (let t = firstTick; t <= tMax; t += weekMs) ticks.push(t);

  const nowPoint = series.points[series.nowIndex];
  const band = bandPath();

  // Area fill under the logged-dose curve.
  const areaD =
    `${pathD(series.points)} L ${x(tMax).toFixed(1)} ${baseY.toFixed(1)} ` +
    `L ${x(tMin).toFixed(1)} ${baseY.toFixed(1)} Z`;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: Math.min(width, 320) }}>
        <rect width={width} height={height} fill="transparent" />

        {/* Horizontal gridlines */}
        {[0.5, 1].map((frac) => (
          <line
            key={frac}
            x1={PADDING.left}
            y1={y(cMax * frac)}
            x2={width - PADDING.right}
            y2={y(cMax * frac)}
            stroke="var(--color-line)"
            strokeDasharray="3 4"
          />
        ))}

        {/* Axes */}
        <line x1={PADDING.left} y1={baseY} x2={width - PADDING.right} y2={baseY} stroke="var(--color-faint)" />
        <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={baseY} stroke="var(--color-faint)" />

        {/* X-axis date labels (weekly) */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={baseY} x2={x(t)} y2={baseY + 3} stroke="var(--color-faint)" />
            <text x={x(t)} y={baseY + 14} textAnchor="middle" className="fill-faint text-[9px]">
              {formatDay(t)}
            </text>
          </g>
        ))}

        {/* Uncertainty band */}
        {band ? <path d={band} fill="var(--color-paper)" opacity="0.06" /> : null}

        {/* Area under the logged curve */}
        <path d={areaD} fill="#F4EE35" opacity="0.07" />

        {/* Chosen-schedule overlay (where you'd sit) */}
        {overlay && overlay.points.length > 1 ? (
          <path d={pathD(overlay.points)} fill="none" stroke="#5FD0C5" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.85" />
        ) : null}

        {/* Metabolite series */}
        {series.metaboliteSeries?.map((ms, i) => (
          <path key={ms.name} d={pathD(ms.points)} fill="none" stroke={METABOLITE_COLOURS[i % METABOLITE_COLOURS.length]} strokeWidth="1" opacity="0.7" />
        ))}

        {/* Logged-dose curve */}
        <path d={pathD(series.points)} fill="none" stroke="var(--color-paper)" strokeWidth="2" />

        {/* Dose markers */}
        {series.doseMarkers.map((d, i) => (
          <line key={i} x1={x(d.timestamp)} y1={baseY} x2={x(d.timestamp)} y2={baseY - 5} stroke="#F4EE35" strokeWidth="2" />
        ))}

        {/* "Now" divider */}
        {nowPoint ? (
          <g>
            <line x1={x(nowPoint.timestamp)} y1={PADDING.top - 2} x2={x(nowPoint.timestamp)} y2={baseY} stroke="var(--color-paper)" strokeWidth="1" strokeDasharray="2 2" opacity="0.55" />
            <text x={x(nowPoint.timestamp)} y={PADDING.top - 6} textAnchor="middle" className="fill-muted text-[9px]">now</text>
          </g>
        ) : null}

        {/* Y-axis label */}
        <text x={12} y={PADDING.top + innerH / 2} textAnchor="middle" transform={`rotate(-90, 12, ${PADDING.top + innerH / 2})`} className="fill-faint text-[9px]">
          modelled level
        </text>

        {/* Past / projected hint along the bottom */}
        <text x={PADDING.left + 2} y={height - 4} className="fill-faint text-[8px]">logged history</text>
        <text x={width - PADDING.right - 2} y={height - 4} textAnchor="end" className="fill-faint text-[8px]">projected</text>
      </svg>

      {showLegend ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-faint">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 bg-paper" /> level from your logs
          </span>
          {overlay ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: "#5FD0C5" }} /> if you follow your schedule
            </span>
          ) : null}
          {series.upperBound ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm bg-paper/10" /> your-body-may-vary range
            </span>
          ) : null}
          {series.metaboliteSeries?.map((ms, i) => (
            <span key={ms.name} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4" style={{ background: METABOLITE_COLOURS[i % METABOLITE_COLOURS.length] }} />
              {ms.name}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-0.5 bg-accent" /> dose taken
          </span>
        </div>
      ) : null}

      {provenance === "llm_estimated" ? (
        <p className="mt-1 text-[10px] text-faint">
          Half-life looked up by AI from published population data · illustrative,
          not a measurement · not medical advice
        </p>
      ) : null}
    </div>
  );
}
