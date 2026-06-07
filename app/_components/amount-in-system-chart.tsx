import type { ReactNode } from "react";
import {
  makeAmountFn,
  sampleSeries,
  steadyState,
  axisChoice,
  chooseWindowDays,
  type DrugPK,
  type DoseEvent,
  type PrescribedRegimen,
  type SamplePoint,
} from "@/lib/pk/amountInSystem";

// AmountInSystemChart (chart-guidance.md). Pure SVG, no interactivity, so it
// renders as a server component. It draws the estimated amount of a medication
// in the body over time for ANY drug — no drug-specific constants live here.
// The curve uses the medication's identity colour; grid/neutral use our theme
// tokens so it adapts to light/dark. Never alarm-red (PRD §6.1 / §9): an
// overshoot reads as the line rising above the band, not as colour.

const DEFAULT_ACCENT = "#1D9E75"; // calm teal fallback when no identity colour

const FOOTER =
  "Estimated amount in system · illustrative · based on textbook half-life · not medical advice";
const FOOTER_CALIBRATED =
  "Your personal estimate, based on the readings you entered. Illustrative, not a measurement. Not medical advice.";

type ShowFlags = {
  steadyBand?: boolean;
  periodReference?: boolean;
  ribbon?: boolean;
  annotateSteady?: boolean;
  nowMarker?: boolean;
};

export function AmountInSystemChart({
  drug,
  doses,
  prescribed,
  identityColor = DEFAULT_ACCENT,
  show,
  nowDays,
  className,
}: {
  drug: DrugPK;
  doses: DoseEvent[];
  prescribed?: PrescribedRegimen;
  identityColor?: string;
  show?: ShowFlags;
  /** "you are here": days from origin; past solid, future dashed */
  nowDays?: number;
  className?: string;
}) {
  const title = `${drug.name} — amount in your system`;
  const footer =
    drug.provenance === "user_calibrated" ? FOOTER_CALIBRATED : FOOTER;

  // ── Linearity gate (§4.7): no curve, honest panel. ────────────────────────
  if (!drug.isLinear) {
    return (
      <figure className={className} style={{ margin: 0 }}>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-muted)", padding: "8px 2px" }}>
          This medication doesn&rsquo;t follow simple curve maths, so a modelled
          level would mislead. Track your doses and talk to your clinician.
        </p>
        <figcaption style={{ fontSize: 11, color: "var(--color-faint)", marginTop: 4 }}>
          Not modelled · not medical advice
        </figcaption>
      </figure>
    );
  }

  const sorted = [...doses].sort((a, b) => a.t - b.t);

  // ── Axis + window (§4.5). Round the window up to a whole unit. ─────────────
  const rawWindow = chooseWindowDays(
    sorted,
    drug.halfLifeDays,
    prescribed?.intervalDays ?? 7
  );
  const probe = axisChoice(rawWindow, drug.halfLifeDays);
  const days = Math.max(probe.unitDays, Math.ceil(rawWindow / probe.unitDays) * probe.unitDays);
  const ax = axisChoice(days, drug.halfLifeDays);

  const amountFn = makeAmountFn(drug.halfLifeDays, sorted);
  const series = sampleSeries(amountFn, sorted, ax.days);

  const wantBand = (show?.steadyBand ?? Boolean(prescribed)) && Boolean(prescribed);
  const ss = wantBand && prescribed ? steadyState(drug.halfLifeDays, prescribed, ax.days) : null;

  const wantRibbon = show?.ribbon ?? Boolean(drug.halfLifeRangeDays);
  const wantPeriod =
    (show?.periodReference ?? Boolean(prescribed?.perPeriodDose)) &&
    Boolean(prescribed?.perPeriodDose);
  const annotateSteady = show?.annotateSteady ?? true;

  // ── Geometry (matches the reference). ─────────────────────────────────────
  const W = 680;
  const H = 255;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  let vmax = 0;
  for (const p of series) vmax = Math.max(vmax, p.v);
  if (wantPeriod && prescribed?.perPeriodDose) vmax = Math.max(vmax, prescribed.perPeriodDose);
  const YMAX = Math.ceil((vmax * 1.08) / 100) * 100 || 100;
  const vstep = YMAX / 100 > 7 ? 200 : 100;

  const x = (t: number) => padL + (t / ax.days) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / YMAX) * (H - padT - padB);
  const r1 = (n: number) => n.toFixed(1);
  const baseY = y(0);

  const INK2 = "var(--color-muted)";
  const INK3 = "var(--color-faint)";
  const NEUTRAL = "var(--color-faint)";
  const GRID = "var(--color-line)";

  const pathOf = (pts: SamplePoint[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${r1(x(p.t))} ${r1(y(p.v))}`).join(" ");

  const els: ReactNode[] = [];
  let key = 0;
  const push = (node: ReactNode) => els.push(<g key={key++}>{node}</g>);

  // weekly/daily vertical gridlines
  for (let u = 0; u * ax.unitDays <= ax.days + 1e-9; u++) {
    const xx = x(u * ax.unitDays);
    push(<line x1={r1(xx)} y1={padT} x2={r1(xx)} y2={r1(baseY)} stroke={GRID} strokeWidth={1} opacity={0.5} />);
  }
  // value gridlines + labels
  for (let v = 0; v <= YMAX; v += vstep) {
    const yy = y(v);
    push(
      <>
        <line x1={padL} y1={r1(yy)} x2={W - padR} y2={r1(yy)} stroke={GRID} strokeWidth={0.5} />
        <text x={padL - 6} y={r1(yy + 4)} textAnchor="end" style={{ fontSize: 11, fill: INK3 }}>{v}</text>
      </>
    );
  }
  // numeric axis labels + unit captions
  for (let u = 0; u * ax.unitDays <= ax.days + 1e-9; u += ax.labelEvery) {
    push(<text x={r1(x(u * ax.unitDays))} y={r1(baseY + 15)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{u}</text>);
  }
  push(<text x={r1((padL + W - padR) / 2)} y={r1(baseY + 29)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{ax.unitLabel}</text>);
  push(<text x={padL - 6} y={12} textAnchor="end" style={{ fontSize: 11, fill: INK3 }}>{drug.unit}</text>);

  // steady band
  if (ss) {
    push(
      <>
        <rect x={x(0)} y={r1(y(ss.peak))} width={r1(x(ax.days) - x(0))} height={r1(y(ss.trough) - y(ss.peak))} fill={identityColor} fillOpacity={0.1} />
        <line x1={x(0)} y1={r1(y(ss.avg))} x2={W - padR} y2={r1(y(ss.avg))} stroke={identityColor} strokeWidth={1} strokeDasharray="4 3" />
        <text x={W - padR} y={r1(y(ss.peak) - 5)} textAnchor="end" style={{ fontSize: 11, fill: INK2 }}>
          steady level ≈ {Math.round(ss.avg)} {drug.unit} on board
        </text>
      </>
    );
  }

  // uncertainty ribbon (±12% band around the curve)
  if (wantRibbon && series.length > 1) {
    const up = series.map((p, i) => `${i ? "L" : "M"}${r1(x(p.t))} ${r1(y(Math.min(YMAX, p.v * 1.12)))}`).join(" ");
    const dn = [...series].reverse().map((p) => `L${r1(x(p.t))} ${r1(y(p.v * 0.88))}`).join(" ");
    push(<path d={`${up} ${dn} Z`} fill={identityColor} fillOpacity={0.12} />);
  }

  // period-dose reference (the INPUT, never a target)
  if (wantPeriod && prescribed?.perPeriodDose) {
    const pv = prescribed.perPeriodDose;
    const label = prescribed.perPeriodLabel ?? `${pv} ${drug.unit} = one period's dose (what goes in)`;
    push(
      <>
        <line x1={x(0)} y1={r1(y(pv))} x2={W - padR} y2={r1(y(pv))} stroke={NEUTRAL} strokeWidth={1} strokeDasharray="2 3" />
        <text x={x(0.4)} y={r1(y(pv) + 13)} style={{ fontSize: 11, fill: INK2 }}>{label}</text>
      </>
    );
  }

  // curve — solid past, dashed future when a now-marker is given
  if (series.length > 1) {
    if (typeof nowDays === "number" && nowDays > 0 && nowDays < ax.days) {
      const past = series.filter((p) => p.t <= nowDays);
      const future = series.filter((p) => p.t >= nowDays);
      push(<path d={pathOf(past)} fill="none" stroke={identityColor} strokeWidth={2} />);
      if (future.length > 1)
        push(<path d={pathOf(future)} fill="none" stroke={identityColor} strokeWidth={2} strokeDasharray="5 3" opacity={0.85} />);
    } else {
      push(<path d={pathOf(series)} fill="none" stroke={identityColor} strokeWidth={2} />);
    }
  }

  // dose ticks: taken solid, missed hollow/dashed, big bold + "n×"
  for (const e of sorted) {
    const tx = x(e.t);
    const isBig = e.big ?? (prescribed ? e.amount > prescribed.perDose * 1.5 : false);
    if (e.taken && isBig) {
      const mult = prescribed?.perDose ? Math.round(e.amount / prescribed.perDose) : null;
      push(
        <>
          <line x1={r1(tx)} y1={r1(baseY)} x2={r1(tx)} y2={r1(baseY - 16)} stroke={identityColor} strokeWidth={3} />
          {mult ? <text x={r1(tx)} y={r1(baseY - 19)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>{mult}×</text> : null}
        </>
      );
    } else if (e.taken) {
      push(<line x1={r1(tx)} y1={r1(baseY)} x2={r1(tx)} y2={r1(baseY - 6)} stroke={identityColor} strokeWidth={2} />);
    } else {
      push(<line x1={r1(tx)} y1={r1(baseY)} x2={r1(tx)} y2={r1(baseY - 6)} stroke={NEUTRAL} strokeWidth={1.4} strokeDasharray="2 2" />);
    }
  }

  // steady-reached annotation (~5 half-lives)
  if (ss && annotateSteady) {
    const tt = 5 * drug.halfLifeDays;
    if (tt < ax.days) {
      push(
        <>
          <line x1={r1(x(tt))} y1={r1(y(ss.avg))} x2={r1(x(tt))} y2={r1(y(ss.avg) - 30)} stroke={NEUTRAL} strokeWidth={0.8} />
          <text x={r1(x(tt))} y={r1(y(ss.avg) - 34)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>≈ steady — stops climbing</text>
        </>
      );
    }
  }

  // now marker
  if ((show?.nowMarker ?? typeof nowDays === "number") && typeof nowDays === "number" && nowDays > 0 && nowDays < ax.days) {
    push(
      <>
        <line x1={r1(x(nowDays))} y1={padT} x2={r1(x(nowDays))} y2={r1(baseY)} stroke={NEUTRAL} strokeWidth={1} strokeDasharray="2 2" opacity={0.7} />
        <text x={r1(x(nowDays))} y={padT - 4} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>now</text>
      </>
    );
  }

  const summary = `${drug.name} amount in system over about ${Math.round(ax.days / ax.unitDays)} ${ax.unitLabel}: rises then ${
    ss ? `plateaus around ${Math.round(ss.avg)} ${drug.unit}` : "follows the logged doses"
  }${wantPeriod && prescribed?.perPeriodDose ? `, above the ${prescribed.perPeriodDose} ${drug.unit} per-period dose line` : ""}.`;

  return (
    <figure className={className} style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        style={{ display: "block", width: "100%", height: "auto" }}
      >
        <title>{title}</title>
        {els}
      </svg>
      <figcaption style={{ fontSize: 11, color: "var(--color-faint)", marginTop: 6 }}>
        {footer}
      </figcaption>
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
