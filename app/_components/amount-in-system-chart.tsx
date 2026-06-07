import type { ReactNode } from "react";
import {
  makeAmountFnForDrug,
  sampleSeries,
  curveShape,
  accumulationRatio,
  regimeOf,
  steadyStateForDrug,
  fractionToSteady,
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
  cursorDate,
  className,
}: {
  drug: DrugPK;
  doses: DoseEvent[];
  prescribed?: PrescribedRegimen;
  identityColor?: string;
  show?: ShowFlags;
  /** "you are here": days from origin; past solid, future dashed */
  nowDays?: number;
  /** the real calendar date at `nowDays`; enables the date axis */
  nowDate?: Date;
  /** scrubbed date from the calendar wheel: draws a movable read-out line at
   *  that date (suppressed when it equals today, where the Today line covers it) */
  cursorDate?: Date;
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
  // The band is the ASYMPTOTIC steady range the prescribed schedule heads
  // toward (kernel-aware simulation past steady), not a windowed average of the
  // still-building curve — so "building up toward ≈ X" names the destination.
  const wantBand =
    (show?.steadyBand ?? Boolean(prescribed)) &&
    accumulates &&
    haveHistory &&
    Boolean(prescribed);
  const band = wantBand && prescribed ? steadyStateForDrug(drug, prescribed) : null;
  // How far up the ramp the logged history has actually climbed (descriptive
  // only — §4.4; never a cue to act).
  const percentToSteady =
    band && !reachedSteady
      ? Math.max(0, Math.min(99, Math.round(fractionToSteady(drug.halfLifeDays, dosingElapsed) * 100)))
      : null;
  // ~5 half-lives to settle — shown in plain language in the explainer.
  const timeToSteadyDays = 5 * drug.halfLifeDays;
  const timeToSteadyLabel =
    timeToSteadyDays >= 14
      ? `${Math.round(timeToSteadyDays / 7)} weeks`
      : `${Math.round(timeToSteadyDays)} days`;

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

  // ── Geometry. The day strip used to live on top of the chart; it now comes
  //    from the shared calendar wheel above, so the chart just keeps headroom
  //    for the Today label + band caption. ────────────────────────────────────
  const W = 680;
  // showDates reserves two stacked header rows above the plot — the scrubbed
  // read-out and the Today label — so they can never overlap (they sit on
  // different lines regardless of how close the two dates are).
  const H = showDates ? 252 : 264;
  const padL = 46;
  const padR = 16;
  const chartTop = showDates ? 60 : 18;
  const chartBot = showDates ? 210 : 222;
  const plotW = W - padL - padR;
  // Header label rows (only meaningful when showDates).
  const cursorRowY = chartTop - 22; // upper row: scrubbed date read-out
  const todayRowY = chartTop - 6; // lower row: Today · date

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

  // Scrubbed-date cursor: map the wheel's selected date onto the chart's t-axis.
  // Compare CALENDAR days (not raw ms / rounded offsets) so a selection on today
  // never draws a duplicate line just because "now" is a different time of day.
  const startOfLocalDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const cursorDayDiff =
    showDates && cursorDate && nowDate
      ? Math.round((startOfLocalDay(cursorDate) - startOfLocalDay(nowDate)) / DAY_MS)
      : null;
  const cursorT = cursorDayDiff != null ? (nowDays as number) + cursorDayDiff : null;
  const showCursor =
    cursorT != null && cursorDayDiff !== 0 && cursorT >= 0 && cursorT <= ax.days;

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

  // ── Steady band ───────────────────────────────────────────────────────────
  if (band) {
    const buildingUp = !reachedSteady;
    push(
      <>
        <rect x={x(0)} y={r1(y(band.peak))} width={r1(x(ax.days) - x(0))} height={r1(y(band.trough) - y(band.peak))} fill={identityColor} fillOpacity={buildingUp ? 0.06 : 0.1} />
        <line x1={x(0)} y1={r1(y(band.avg))} x2={W - padR} y2={r1(y(band.avg))} stroke={identityColor} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={buildingUp ? 0.6 : 1} />
        <text x={W - padR} y={r1(y(band.peak) - 5)} textAnchor="end" style={{ fontSize: 11, fill: INK2 }}>
          {buildingUp
            ? `projected steady range ≈ ${Math.round(band.avg)} ${drug.unit} — building up${percentToSteady != null ? ` (≈ ${percentToSteady}% there)` : ""}`
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
        <line x1={r1(todayX)} y1={r1(todayRowY + 4)} x2={r1(todayX)} y2={r1(chartBot)} stroke={INK2} strokeWidth={1.25} strokeDasharray="4 3" />
        <text x={r1(todayX)} y={r1(todayRowY)} textAnchor="middle" style={{ fontSize: 11, fill: INK2 }}>Today · {fmtDate(nowDate)}</text>
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

  // ── Scrubbed-date read-out: a movable line + dot showing the modelled level
  //    on the date centred in the calendar wheel above. ───────────────────────
  if (showCursor && cursorDate && cursorT != null) {
    const cx = x(cursorT);
    const level = amountFn(cursorT);
    const cy = y(Math.min(YMAX, level));
    const label = `${fmtDate(cursorDate)} · ≈ ${Math.round(level)} ${drug.unit}`;
    // keep the label inside the frame near the edges
    const anchor = cx > W - padR - 90 ? "end" : cx < padL + 90 ? "start" : "middle";
    const labelX = anchor === "end" ? cx - 4 : anchor === "start" ? cx + 4 : cx;
    // Read-out sits on the UPPER header row; the Today label is on the row below,
    // so the two never overlap even for adjacent dates.
    push(
      <>
        <line x1={r1(cx)} y1={r1(cursorRowY + 4)} x2={r1(cx)} y2={r1(chartBot)} stroke={identityColor} strokeWidth={1} strokeOpacity={0.9} />
        <circle cx={r1(cx)} cy={r1(cy)} r={3.5} fill={identityColor} />
        <text x={r1(labelX)} y={r1(cursorRowY)} textAnchor={anchor} style={{ fontSize: 11, fill: INK2 }}>{label}</text>
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

  // ── Plain-language explainer (tap to expand). Pure HTML <details>, so it
  //    works without client JS. Copy stays on the §6.1 wellness line:
  //    illustrative, never "your actual level", never an instruction to dose. ─
  const weeklyInput =
    wantPeriod && prescribed?.perPeriodDose ? prescribed.perPeriodDose : null;
  let explainer: ReactNode = null;
  if (band) {
    explainer = (
      <>
        Each dose adds to what&rsquo;s already in your system, then fades on the
        medication&rsquo;s half-life. Because the next dose tends to arrive before the
        last has cleared, the modelled amount climbs for about {timeToSteadyLabel}{" "}
        and then settles into a repeating range — here about{" "}
        {Math.round(band.avg)} {drug.unit}
        {weeklyInput
          ? `, higher than the ${weeklyInput} ${drug.unit} that goes in each week because earlier doses are still on board`
          : ""}
        . This is illustrative, based on textbook half-life — not a measurement of
        your actual level. A blood test with your clinician is what confirms that.
        Missed doses show up as the modelled line dipping below this range.
      </>
    );
  } else if (regime === "clears") {
    explainer = (
      <>
        Because the gap between doses is long compared with the medication&rsquo;s
        half-life, most of each dose clears before the next — so the modelled
        amount rises after a dose and falls back toward zero instead of leveling
        off into a plateau. This is illustrative, based on textbook half-life —
        not a measurement of your actual level; a blood test with your clinician
        confirms that.
      </>
    );
  }

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
      {explainer ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, color: "var(--color-muted)", cursor: "pointer" }}>
            {band ? "How the steady range is worked out" : "How this reads"}
          </summary>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)", marginTop: 6 }}>
            {explainer}
          </p>
        </details>
      ) : null}
      <figcaption style={{ fontSize: 11, color: "var(--color-faint)", marginTop: 6 }}>
        {footer}
      </figcaption>
      <span className="sr-only">{summary}</span>
    </figure>
  );
}
