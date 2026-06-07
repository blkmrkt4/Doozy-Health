import type { ReactNode } from "react";
import {
  makeAmountFnForDrug,
  sampleSeries,
  curveShape,
  accumulationRatio,
  regimeOf,
  bandFromSeries,
  axisChoice,
  chooseWindowDays,
  type DrugPK,
  type DoseEvent,
  type PrescribedRegimen,
  type SamplePoint,
} from "@/lib/pk/amountInSystem";

// AmountInSystemChart (chart-guidance.md + revision v2). Pure SVG, no
// interactivity, so it renders as a server component. It draws the estimated
// amount of a medication in the body over time for ANY drug — no drug-specific
// constants live here. The curve uses the medication's identity colour;
// grid/neutral use our theme tokens so it adapts to light/dark. Never alarm-red
// (PRD §6.1 / §9): an overshoot reads as the line rising above the band, not as
// colour.
//
// Revision v2 (five fixes):
//  1. Route-aware curve shape — depot/transdermal doses rise to a peak over
//     ~Tmax (rounded waves); only fast routes (oral IR, IV) jump instantly.
//  2. Regimen-aware narrative — the accumulation ratio R decides whether to
//     tell the steady-plateau story or the "clears between doses" story.
//  3. The input-vs-level reference shows only in the accumulation regime.
//  4. No steady-state claim until ~5 half-lives of dosing have actually elapsed.
//  5. A real-date x-axis anchored at a labelled "Today" line, with a day strip
//     synced so today sits at the same horizontal position in both.

const DEFAULT_ACCENT = "#1D9E75"; // calm teal fallback when no identity colour

const FOOTER =
  "Estimated amount in system · illustrative · based on textbook half-life · not medical advice";
const FOOTER_CALIBRATED =
  "Your personal estimate, based on the readings you entered. Illustrative, not a measurement. Not medical advice.";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const fmtDate = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

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
  nowDate,
  className,
}: {
  drug: DrugPK;
  doses: DoseEvent[];
  prescribed?: PrescribedRegimen;
  identityColor?: string;
  show?: ShowFlags;
  /** "you are here": days from origin; past solid, future dashed */
  nowDays?: number;
  /** the real calendar date at `nowDays`; enables the date axis + day strip */
  nowDate?: Date;
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

  // ── Route-aware curve (Fix 1). Slow routes rise to a peak; fast routes jump.
  const shape = curveShape(drug);
  const amountFn = makeAmountFnForDrug(drug, sorted);
  const series = sampleSeries(amountFn, sorted, ax.days, {
    crispJumps: shape === "instant",
  });

  // ── Real-date anchoring (Fix 5). ──────────────────────────────────────────
  const showDates = nowDate != null && typeof nowDays === "number";
  const dateAt = (t: number) =>
    showDates ? addDays(nowDate as Date, Math.round(t - (nowDays as number))) : null;

  // ── Accumulation regime + history (Fix 2 / Fix 4). ────────────────────────
  const tau = prescribed?.intervalDays;
  const R = prescribed && tau ? accumulationRatio(drug.halfLifeDays, tau) : null;
  const regime = R != null ? regimeOf(R) : null;
  const accumulates = regime === "accumulates" || regime === "intermediate";

  // How much real dosing history backs a steady-state claim?
  const nowT =
    typeof nowDays === "number"
      ? nowDays
      : sorted.some((d) => d.taken)
        ? Math.max(...sorted.filter((d) => d.taken).map((d) => d.t))
        : ax.days;
  const takenPast = sorted.filter((d) => d.taken && d.t <= nowT);
  const haveHistory = takenPast.length >= 2;
  const firstDoseT = takenPast.length ? takenPast[0].t : nowT;
  const dosingElapsed = nowT - firstDoseT;
  const reachedSteady = haveHistory && dosingElapsed >= 5 * drug.halfLifeDays;

  // Steady band — only in an accumulating regime with at least some history.
  // Derived from the modelled curve's projected steady tail so it always lines
  // up with the drawn line, whatever the route's kernel.
  const wantBand =
    (show?.steadyBand ?? Boolean(prescribed)) &&
    accumulates &&
    haveHistory &&
    Boolean(prescribed);
  const bandWin = Math.max(tau ?? 7, 7);
  const band = wantBand ? bandFromSeries(series, ax.days - bandWin, ax.days) : null;

  // Clears-between reading (Fix 2): a per-dose peak and the pre-next trough.
  let clears: { peak: number; trough: number } | null = null;
  if (regime === "clears") {
    const w = tau ?? 7;
    const seg = series.filter((p) => p.t >= ax.days - w && p.t <= ax.days);
    if (seg.length) {
      let pk = 0;
      let tr = Infinity;
      for (const p of seg) {
        pk = Math.max(pk, p.v);
        tr = Math.min(tr, p.v);
      }
      clears = { peak: pk, trough: Math.max(0, tr) };
    }
  }

  const wantRibbon = show?.ribbon ?? Boolean(drug.halfLifeRangeDays);
  // Input-vs-level reference shows ONLY in the accumulation regime (Fix 3).
  const wantPeriod =
    (show?.periodReference ?? Boolean(prescribed?.perPeriodDose)) &&
    Boolean(prescribed?.perPeriodDose) &&
    accumulates;
  const annotateSteady = show?.annotateSteady ?? true;

  // ── Geometry — reference v2 layout: a day strip on top, the chart below,
  //    joined by the Today line. ─────────────────────────────────────────────
  const W = 680;
  const H = showDates ? 300 : 264;
  const padL = 46;
  const padR = 16;
  const chartTop = showDates ? 112 : 18;
  const chartBot = showDates ? 262 : 222;
  const plotW = W - padL - padR;

  let vmax = 0;
  for (const p of series) vmax = Math.max(vmax, p.v);
  if (wantPeriod && prescribed?.perPeriodDose) vmax = Math.max(vmax, prescribed.perPeriodDose);
  if (band) vmax = Math.max(vmax, band.peak);
  // Tighten the y-axis to sit just above the peak (not a fixed 100) so the curve
  // fills the frame.
  const YMAX = Math.ceil((vmax * 1.12) / 10) * 10 || 10;
  const vstep = Math.max(10, Math.round(YMAX / 4 / 10) * 10);

  const x = (t: number) => padL + (t / ax.days) * plotW;
  const y = (v: number) => chartTop + (1 - v / YMAX) * (chartBot - chartTop);
  const r1 = (n: number) => n.toFixed(1);
  const baseY = y(0);

  const INK2 = "var(--color-muted)";
  const INK3 = "var(--color-faint)";
  const NEUTRAL = "var(--color-faint)";
  const GRID = "var(--color-line)";

  const hasNow =
    typeof nowDays === "number" && nowDays > 0 && nowDays < ax.days;
  const todayX = hasNow ? x(nowDays as number) : null;

  const pathOf = (pts: SamplePoint[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${r1(x(p.t))} ${r1(y(p.v))}`).join(" ");

  const els: ReactNode[] = [];
  let key = 0;
  const push = (node: ReactNode) => els.push(<g key={key++}>{node}</g>);

  // ── Gridlines ─────────────────────────────────────────────────────────────
  for (let u = 0; u * ax.unitDays <= ax.days + 1e-9; u++) {
    const xx = x(u * ax.unitDays);
    push(<line x1={r1(xx)} y1={chartTop} x2={r1(xx)} y2={r1(baseY)} stroke={GRID} strokeWidth={0.5} opacity={0.6} />);
  }
  for (let v = 0; v <= YMAX; v += vstep) {
    const yy = y(v);
    push(
      <>
        <line x1={padL} y1={r1(yy)} x2={W - padR} y2={r1(yy)} stroke={GRID} strokeWidth={0.5} />
        <text x={padL - 6} y={r1(yy + 4)} textAnchor="end" style={{ fontSize: 11, fill: INK3 }}>{v}</text>
      </>
    );
  }
  // native-unit caption at the top-left of the y-axis
  push(<text x={padL - 6} y={r1(chartTop - 4)} textAnchor="end" style={{ fontSize: 11, fill: INK3 }}>{drug.unit}</text>);

  // ── X-axis labels: real dates (Fix 5), else abstract unit numbers. ────────
  if (showDates) {
    for (let u = 0; u * ax.unitDays <= ax.days + 1e-9; u += ax.labelEvery) {
      const off = u * ax.unitDays;
      const d = dateAt(off);
      if (d) push(<text x={r1(x(off))} y={r1(baseY + 15)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{fmtDate(d)}</text>);
    }
    // faint secondary "weeks/days since start" cue + the visible date span
    push(<text x={r1((padL + W - padR) / 2)} y={r1(baseY + 28)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{ax.unitLabel}</text>);
    const dStart = dateAt(0);
    const dEnd = dateAt(ax.days);
    if (dStart && dEnd)
      push(<text x={W - padR} y={14} textAnchor="end" style={{ fontSize: 11, fill: INK3 }}>{fmtDate(dStart)} – {fmtDate(dEnd)}</text>);
  } else {
    for (let u = 0; u * ax.unitDays <= ax.days + 1e-9; u += ax.labelEvery) {
      push(<text x={r1(x(u * ax.unitDays))} y={r1(baseY + 15)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{u}</text>);
    }
    push(<text x={r1((padL + W - padR) / 2)} y={r1(baseY + 28)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>{ax.unitLabel}</text>);
  }

  // ── Calendar strip synced to the chart (Fix 5). A zoomed day ruler centred
  //    on today, with today at the SAME x as the chart's Today line. ──────────
  if (showDates && nowDate && todayX != null) {
    const weekdayY = 40;
    const dateNumY = 60;
    const doseDotY = 38;
    const spd = plotW / 22; // ~22 days visible across the strip
    const kStart = Math.ceil((padL - todayX) / spd);
    const kEnd = Math.floor((W - padR - todayX) / spd);
    for (let kk = kStart; kk <= kEnd; kk++) {
      const dx = todayX + kk * spd;
      const d = addDays(nowDate, kk);
      push(<text x={r1(dx)} y={weekdayY} textAnchor="middle" style={{ fontSize: 10.5, fill: INK3 }}>{WEEKDAYS[d.getDay()]}</text>);
      if (kk === 0)
        push(<circle cx={r1(dx)} cy={dateNumY - 5} r={11} fill="none" stroke={identityColor} strokeWidth={1.5} />);
      push(
        <text
          x={r1(dx)}
          y={dateNumY}
          textAnchor="middle"
          style={{ fontSize: 12, fill: kk === 0 ? "var(--color-paper)" : INK2, fontWeight: kk === 0 ? 600 : 400 }}
        >
          {d.getDate()}
        </text>
      );
    }
    // dose dots on the strip: taken solid, missed hollow
    for (const e of sorted) {
      const dayoff = Math.round(e.t - (nowDays as number));
      if (dayoff < kStart || dayoff > kEnd) continue;
      const dx = todayX + dayoff * spd;
      if (e.taken)
        push(<circle cx={r1(dx)} cy={doseDotY} r={2.6} fill={identityColor} />);
      else
        push(<circle cx={r1(dx)} cy={doseDotY} r={2.4} fill="none" stroke={NEUTRAL} strokeWidth={1} />);
    }
  }

  // ── Steady band ───────────────────────────────────────────────────────────
  if (band) {
    const buildingUp = !reachedSteady;
    push(
      <>
        <rect x={x(0)} y={r1(y(band.peak))} width={r1(x(ax.days) - x(0))} height={r1(y(band.trough) - y(band.peak))} fill={identityColor} fillOpacity={buildingUp ? 0.06 : 0.1} />
        <line x1={x(0)} y1={r1(y(band.avg))} x2={W - padR} y2={r1(y(band.avg))} stroke={identityColor} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={buildingUp ? 0.6 : 1} />
        <text x={W - padR} y={r1(y(band.peak) - 5)} textAnchor="end" style={{ fontSize: 11, fill: INK2 }}>
          {buildingUp
            ? `projected steady range ≈ ${Math.round(band.avg)} ${drug.unit} — building up`
            : `steady range ≈ ${Math.round(band.avg)} ${drug.unit} on board`}
        </text>
      </>
    );
  }

  // ── Clears-between reading (no plateau language) ──────────────────────────
  if (clears) {
    push(
      <text x={padL} y={r1(chartTop + 14)} style={{ fontSize: 11, fill: INK2 }}>
        largely clears between doses — peaks ≈ {Math.round(clears.peak)} {drug.unit}, falls to ≈ {Math.round(clears.trough)} {drug.unit} before the next
      </text>
    );
  }

  // ── Uncertainty ribbon (±12% band around the curve) ───────────────────────
  if (wantRibbon && series.length > 1) {
    const up = series.map((p, i) => `${i ? "L" : "M"}${r1(x(p.t))} ${r1(y(Math.min(YMAX, p.v * 1.12)))}`).join(" ");
    const dn = [...series].reverse().map((p) => `L${r1(x(p.t))} ${r1(y(p.v * 0.88))}`).join(" ");
    push(<path d={`${up} ${dn} Z`} fill={identityColor} fillOpacity={0.12} />);
  }

  // ── Period-dose reference (the INPUT, never a target) ─────────────────────
  if (wantPeriod && prescribed?.perPeriodDose) {
    const pv = prescribed.perPeriodDose;
    const label = prescribed.perPeriodLabel ?? `${pv} ${drug.unit} per dosing period (what goes in)`;
    push(
      <>
        <line x1={x(0)} y1={r1(y(pv))} x2={W - padR} y2={r1(y(pv))} stroke={NEUTRAL} strokeWidth={1} strokeDasharray="2 3" />
        <text x={x(0.4)} y={r1(y(pv) + 13)} style={{ fontSize: 11, fill: INK2 }}>{label}</text>
      </>
    );
  }

  // ── Curve — solid past, dashed projection split at today ──────────────────
  if (series.length > 1) {
    if (hasNow) {
      const past = series.filter((p) => p.t <= (nowDays as number));
      const future = series.filter((p) => p.t >= (nowDays as number));
      push(<path d={pathOf(past)} fill="none" stroke={identityColor} strokeWidth={2} />);
      if (future.length > 1)
        push(<path d={pathOf(future)} fill="none" stroke={identityColor} strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.85} />);
    } else {
      push(<path d={pathOf(series)} fill="none" stroke={identityColor} strokeWidth={2} />);
    }
  }

  // ── Dose ticks: taken solid, missed hollow/dashed, big bold + "n×" ────────
  for (const e of sorted) {
    if (e.t < 0 || e.t > ax.days) continue;
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

  // ── Steady-reached annotation (Fix 4): only once ~5 half-lives of dosing
  //    have actually elapsed; before that the band reads "building up". ───────
  if (band && annotateSteady && reachedSteady && regime === "accumulates") {
    const tt = firstDoseT + 5 * drug.halfLifeDays;
    if (tt > 0 && tt < ax.days) {
      push(
        <>
          <line x1={r1(x(tt))} y1={r1(y(band.avg))} x2={r1(x(tt))} y2={r1(y(band.avg) - 30)} stroke={NEUTRAL} strokeWidth={0.8} />
          <text x={r1(x(tt))} y={r1(y(band.avg) - 34)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>≈ steady — stops climbing</text>
        </>
      );
    }
  } else if (band && annotateSteady && reachedSteady && regime === "intermediate") {
    const tt = firstDoseT + 5 * drug.halfLifeDays;
    if (tt > 0 && tt < ax.days) {
      push(
        <>
          <line x1={r1(x(tt))} y1={r1(y(band.avg))} x2={r1(x(tt))} y2={r1(y(band.avg) - 30)} stroke={NEUTRAL} strokeWidth={0.8} />
          <text x={r1(x(tt))} y={r1(y(band.avg) - 34)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>approaching its repeating pattern</text>
        </>
      );
    }
  }

  // ── Today line — the chart's primary anchor (Fix 5). ──────────────────────
  if (showDates && hasNow && todayX != null && nowDate) {
    push(
      <>
        <line x1={r1(todayX)} y1={24} x2={r1(todayX)} y2={r1(chartBot)} stroke={INK2} strokeWidth={1.25} strokeDasharray="4 3" />
        <text x={r1(todayX)} y={r1(chartTop - 4)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>Today · {fmtDate(nowDate)}</text>
      </>
    );
  } else if (hasNow && todayX != null) {
    // no dates available: a plain neutral "now" marker
    push(
      <>
        <line x1={r1(todayX)} y1={chartTop} x2={r1(todayX)} y2={r1(baseY)} stroke={NEUTRAL} strokeWidth={1} strokeDasharray="2 2" opacity={0.7} />
        <text x={r1(todayX)} y={r1(chartTop - 4)} textAnchor="middle" style={{ fontSize: 11, fill: INK3 }}>now</text>
      </>
    );
  }

  const regimeSummary = clears
    ? `largely clears between doses (peaks ≈ ${Math.round(clears.peak)} ${drug.unit})`
    : band
      ? reachedSteady
        ? `plateaus around ${Math.round(band.avg)} ${drug.unit}`
        : `building up toward ≈ ${Math.round(band.avg)} ${drug.unit}`
      : "follows the logged doses";
  const summary = `${drug.name} amount in system over about ${Math.round(ax.days / ax.unitDays)} ${ax.unitLabel}: rises then ${regimeSummary}${
    wantPeriod && prescribed?.perPeriodDose ? `, above the ${prescribed.perPeriodDose} ${drug.unit} per-period input line` : ""
  }.`;

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
