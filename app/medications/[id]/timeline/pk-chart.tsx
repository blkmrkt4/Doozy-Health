"use client";

import type { PkTimeSeries } from "@/lib/pharmacokinetics";

// Pure SVG pharmacokinetic chart (PRD §5.7, §9).
// No charting library — avoids dependency (CLAUDE.md rule #13).
// Monochrome palette: white curve on black, accent dose markers.
// Never alarmist: no red zones, no "dose now" prompts.

const CHART_HEIGHT = 220;
const PADDING = { top: 20, right: 16, bottom: 40, left: 48 };

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PkChart({
  series,
  overlay,
  width = 720,
}: {
  series: PkTimeSeries;
  /** Optional overlay series (e.g. prescribed regimen). */
  overlay?: PkTimeSeries;
  width?: number;
}) {
  if (series.points.length < 2) {
    return <p className="text-sm text-faint">Not enough data to chart.</p>;
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Time range.
  const tMin = series.points[0].timestamp;
  const tMax = series.points[series.points.length - 1].timestamp;
  const tRange = tMax - tMin;

  // Concentration range (include overlay if present).
  let cMax = 0;
  for (const p of series.points) {
    if (p.concentration > cMax) cMax = p.concentration;
  }
  if (overlay) {
    for (const p of overlay.points) {
      if (p.concentration > cMax) cMax = p.concentration;
    }
  }
  if (cMax === 0) cMax = 1; // avoid division by zero

  // Coordinate mappers.
  const x = (t: number) => PADDING.left + ((t - tMin) / tRange) * innerW;
  const y = (c: number) => PADDING.top + innerH - (c / cMax) * innerH;

  // Build SVG path for a series.
  function pathD(pts: { timestamp: number; concentration: number }[]): string {
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.timestamp).toFixed(1)} ${y(p.concentration).toFixed(1)}`)
      .join(" ");
  }

  // X-axis tick marks (one per day).
  const dayMs = 24 * 3_600_000;
  const firstDay = Math.ceil(tMin / dayMs) * dayMs;
  const ticks: number[] = [];
  for (let t = firstDay; t <= tMax; t += dayMs) {
    ticks.push(t);
  }

  // "You are here" marker.
  const nowPoint = series.points[series.nowIndex];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        className="w-full"
        style={{ minWidth: width }}
      >
        {/* Background */}
        <rect width={width} height={CHART_HEIGHT} fill="transparent" />

        {/* Grid lines (horizontal) */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={PADDING.left}
            y1={y(cMax * frac)}
            x2={width - PADDING.right}
            y2={y(cMax * frac)}
            stroke="#262626"
            strokeDasharray="4 4"
          />
        ))}

        {/* X axis */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + innerH}
          x2={width - PADDING.right}
          y2={PADDING.top + innerH}
          stroke="#262626"
        />

        {/* X-axis tick labels */}
        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={PADDING.top + innerH + 16}
            textAnchor="middle"
            className="fill-faint text-[9px]"
          >
            {formatDay(t)}
          </text>
        ))}

        {/* Overlay series (prescribed regimen — muted) */}
        {overlay && overlay.points.length > 1 ? (
          <path
            d={pathD(overlay.points)}
            fill="none"
            stroke="#777777"
            strokeWidth="1"
            strokeDasharray="4 2"
            opacity="0.5"
          />
        ) : null}

        {/* Primary series (chosen/actual) */}
        <path
          d={pathD(series.points)}
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
        />

        {/* Dose markers */}
        {series.doseMarkers.map((d, i) => (
          <g key={i}>
            <line
              x1={x(d.timestamp)}
              y1={PADDING.top}
              x2={x(d.timestamp)}
              y2={PADDING.top + innerH}
              stroke="#F4EE35"
              strokeWidth="1"
              opacity="0.4"
            />
            <circle
              cx={x(d.timestamp)}
              cy={PADDING.top + innerH}
              r="3"
              fill="#F4EE35"
            />
          </g>
        ))}

        {/* "You are here" line */}
        {nowPoint ? (
          <g>
            <line
              x1={x(nowPoint.timestamp)}
              y1={PADDING.top}
              x2={x(nowPoint.timestamp)}
              y2={PADDING.top + innerH}
              stroke="#ffffff"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.6"
            />
            <text
              x={x(nowPoint.timestamp)}
              y={PADDING.top - 6}
              textAnchor="middle"
              className="fill-muted text-[8px]"
            >
              now
            </text>
          </g>
        ) : null}

        {/* Projected trough */}
        {series.projectedTrough &&
        series.projectedTrough.timestamp > nowPoint.timestamp ? (
          <g>
            <circle
              cx={x(series.projectedTrough.timestamp)}
              cy={y(series.projectedTrough.concentration)}
              r="3"
              fill="none"
              stroke="#cccccc"
              strokeWidth="1"
            />
            <text
              x={x(series.projectedTrough.timestamp) + 6}
              y={y(series.projectedTrough.concentration) + 3}
              className="fill-faint text-[8px]"
            >
              trough
            </text>
          </g>
        ) : null}

        {/* Y axis label */}
        <text
          x={10}
          y={PADDING.top + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90, 10, ${PADDING.top + innerH / 2})`}
          className="fill-faint text-[8px]"
        >
          relative level
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-2 flex gap-4 text-[10px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-4 bg-white" /> actual
        </span>
        {overlay ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-faint" />{" "}
            prescribed
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" /> dose
        </span>
      </div>
    </div>
  );
}
