import { COMPLIANCE_COLOURS } from "@/lib/colours";

// Presentational diary-trend charts (PRD §5.9). Pure SVG / markup, no charting
// library (rule #13) and no interactivity, so these render as server components.
// A factual record of what was logged — calm, monochrome + accent, no red zones,
// no advice. American English.

const ACCENT = "#F4EE35";

function shortDate(iso: string): string {
  // iso is YYYY-MM-DD; render as "5 Jun" without constructing a Date in TZ-risky
  // ways — parse the parts directly.
  const [, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[(m ?? 1) - 1] ?? ""}`;
}

function tidy(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function NumericChart({
  points,
  yMin,
  yMax,
}: {
  points: { date: string; value: number }[];
  yMin?: number;
  yMax?: number;
}) {
  if (points.length === 0) return null;

  const W = 600;
  const H = 150;
  const P = { top: 12, right: 16, bottom: 22, left: 30 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;

  const ts = points.map((p) => Date.parse(`${p.date}T12:00:00`));
  const tMin = ts[0];
  const tMax = ts[ts.length - 1];
  const tRange = tMax - tMin || 1;

  const values = points.map((p) => p.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Pad a flat/auto range so the line doesn't hug an edge.
  const vMin = yMin ?? (dataMin === dataMax ? dataMin - 1 : dataMin);
  const vMax = yMax ?? (dataMin === dataMax ? dataMax + 1 : dataMax);
  const vRange = vMax - vMin || 1;

  const x = (t: number) =>
    points.length === 1
      ? P.left + innerW / 2
      : P.left + ((t - tMin) / tRange) * innerW;
  const y = (v: number) => P.top + innerH - ((v - vMin) / vRange) * innerH;
  const baseY = P.top + innerH;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(ts[i]).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const area =
    `${line} L ${x(tMax).toFixed(1)} ${baseY.toFixed(1)} ` +
    `L ${x(tMin).toFixed(1)} ${baseY.toFixed(1)} Z`;

  // Date ticks: first, middle, last (avoid crowding).
  const tickIdx =
    points.length <= 2
      ? points.map((_, i) => i)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 280 }}>
        {/* Y gridlines + labels at min / mid / max */}
        {[vMin, (vMin + vMax) / 2, vMax].map((val, i) => (
          <g key={i}>
            <line
              x1={P.left}
              y1={y(val)}
              x2={W - P.right}
              y2={y(val)}
              stroke="var(--color-line)"
              strokeDasharray="3 4"
            />
            <text
              x={P.left - 5}
              y={y(val) + 3}
              textAnchor="end"
              className="fill-faint text-[9px] tabular"
            >
              {tidy(val)}
            </text>
          </g>
        ))}

        {/* Baseline axis */}
        <line x1={P.left} y1={baseY} x2={W - P.right} y2={baseY} stroke="var(--color-faint)" />

        {/* Area + line */}
        {points.length > 1 ? <path d={area} fill={ACCENT} opacity="0.08" /> : null}
        {points.length > 1 ? (
          <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" />
        ) : null}

        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={x(ts[i])} cy={y(p.value)} r="2.5" fill={ACCENT} />
        ))}

        {/* X-axis date labels */}
        {tickIdx.map((i) => (
          <text
            key={i}
            x={x(ts[i])}
            y={baseY + 14}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-faint text-[9px]"
          >
            {shortDate(points[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function BooleanStrip({
  points,
}: {
  points: { date: string; value: boolean }[];
}) {
  // Most recent ~45 days, oldest first.
  const shown = points.slice(-45);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((p, i) => (
        <span
          key={i}
          title={`${shortDate(p.date)} — ${p.value ? "Yes" : "No"}`}
          className="h-4 w-4 rounded-sm border"
          style={
            p.value
              ? { background: COMPLIANCE_COLOURS.full, borderColor: COMPLIANCE_COLOURS.full }
              : { borderColor: "var(--color-line)" }
          }
        />
      ))}
    </div>
  );
}

export function DistributionBars({
  counts,
  total,
}: {
  counts: { option: string; count: number }[];
  total: number;
}) {
  const max = counts.reduce((m, c) => Math.max(m, c.count), 0) || 1;
  return (
    <div className="space-y-1.5">
      {counts.slice(0, 8).map((c) => (
        <div key={c.option} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs text-muted" title={c.option}>
            {c.option}
          </span>
          <span className="h-3 flex-1 rounded-sm bg-surface">
            <span
              className="block h-3 rounded-sm"
              style={{ width: `${(c.count / max) * 100}%`, background: ACCENT, opacity: 0.7 }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular text-faint">
            {c.count}/{total}
          </span>
        </div>
      ))}
    </div>
  );
}
