import { describe, it, expect } from "vitest";
import {
  decayConstant,
  makeAmountFn,
  sampleSeries,
  steadyState,
  fractionToSteady,
  chooseWindowDays,
  axisChoice,
  eventsFromWeeklyPattern,
  type DoseEvent,
  type PrescribedRegimen,
} from "@/lib/pk/amountInSystem";

const approx = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

describe("amount-in-system PK maths", () => {
  it("decays a single dose by half each half-life", () => {
    const f = makeAmountFn(8, [{ t: 0, amount: 100, taken: true }]);
    expect(approx(f(0), 100)).toBe(true);
    expect(approx(f(8), 50, 1e-9)).toBe(true);
    expect(approx(f(16), 25, 1e-9)).toBe(true);
  });

  it("reproduces the 1 − 0.5ⁿ accumulation when interval = half-life", () => {
    // half-life = 1 day, a dose every day (interval = half-life), 100 units each.
    const hl = 1;
    const doses: DoseEvent[] = Array.from({ length: 8 }, (_, i) => ({
      t: i,
      amount: 100,
      taken: true,
    }));
    const f = makeAmountFn(hl, doses);
    // The trough just before the nth dose = 100·(1 − 0.5ⁿ).
    for (let n = 1; n <= 6; n++) {
      const trough = f(n - 1e-9);
      expect(approx(trough, 100 * (1 - 0.5 ** n), 1e-6)).toBe(true);
    }
  });

  it("fractionToSteady follows 1 − e^(−k·t): ~50/75/88/94/97% at 1…5 half-lives", () => {
    const hl = 5;
    const pct = [1, 2, 3, 4, 5].map((n) =>
      Math.round(fractionToSteady(hl, n * hl) * 100)
    );
    expect(pct).toEqual([50, 75, 88, 94, 97]);
  });

  it("missing dose produces a sag (lower than if it had been taken)", () => {
    const hl = 4;
    const taken: DoseEvent[] = [
      { t: 0, amount: 50, taken: true },
      { t: 4, amount: 50, taken: true },
    ];
    const missed: DoseEvent[] = [
      { t: 0, amount: 50, taken: true },
      { t: 4, amount: 50, taken: false },
    ];
    expect(makeAmountFn(hl, missed)(4)).toBeLessThan(makeAmountFn(hl, taken)(4));
  });

  it("a 3× catch-up dose on top of a steady level spikes above the band peak", () => {
    const hl = 8;
    const prescribed: PrescribedRegimen = { perDose: 65, intervalDays: 7 / 3 };
    const ss = steadyState(hl, prescribed);
    // run a steady regimen, then replace one late dose with a 3× catch-up
    const bigDay = 11 * 7; // week 11, first dosing day
    const doses = eventsFromWeeklyPattern({
      perDose: 65,
      weekdays: [0, 2, 4],
      weeks: 16,
      bigDoses: { [bigDay]: 65 * 3 },
    });
    const f = makeAmountFn(hl, doses);
    expect(f(bigDay)).toBeGreaterThan(ss.peak); // visible spike above the band
  });

  it("steady band matches the closed form perDose / (k · interval) — testosterone ≈ 320", () => {
    const hl = 8;
    const prescribed: PrescribedRegimen = { perDose: 65, intervalDays: 7 / 3 };
    const ss = steadyState(hl, prescribed);
    const k = decayConstant(hl);
    const closedFormAvg = prescribed.perDose / (k * prescribed.intervalDays);
    // discrete simulation converges to the closed form within ~1%
    expect(Math.abs(ss.avg - closedFormAvg) / closedFormAvg).toBeLessThan(0.01);
    expect(Math.round(ss.avg)).toBeGreaterThanOrEqual(315);
    expect(Math.round(ss.avg)).toBeLessThanOrEqual(326);
    expect(ss.trough).toBeLessThan(ss.avg);
    expect(ss.peak).toBeGreaterThan(ss.avg);
  });

  it("picks weeks for a long half-life and days for a short one", () => {
    expect(axisChoice(112, 8).unitLabel).toBe("weeks");
    expect(axisChoice(112, 8).labelEvery).toBe(4);
    expect(axisChoice(12, 1.1).unitLabel).toBe("days"); // sertraline, short window
    expect(axisChoice(12, 1.1).labelEvery).toBe(7);
  });

  it("window spans at least ~5 half-lives plus a projection", () => {
    // sparse early data, long half-life ⇒ window stretches for context
    const doses: DoseEvent[] = [{ t: 0, amount: 100, taken: true }];
    expect(chooseWindowDays(doses, 8, 7 / 3)).toBeGreaterThanOrEqual(40);
  });

  it("eventsFromWeeklyPattern builds sorted events, flags missed and big doses", () => {
    const ev = eventsFromWeeklyPattern({
      perDose: 65,
      weekdays: [0, 2, 4],
      weeks: 2,
      missed: [2],
      bigDoses: { 4: 130 },
    });
    expect(ev).toHaveLength(6);
    expect(ev.map((e) => e.t)).toEqual([0, 2, 4, 7, 9, 11]); // sorted
    expect(ev.find((e) => e.t === 2)?.taken).toBe(false); // missed
    const big = ev.find((e) => e.t === 4);
    expect(big?.amount).toBe(130);
    expect(big?.big).toBe(true);
  });

  it("sampleSeries inserts crisp jump points around each taken dose", () => {
    const doses: DoseEvent[] = [{ t: 3, amount: 50, taken: true }];
    const f = makeAmountFn(8, doses);
    const series = sampleSeries(f, doses, 7);
    const before = series.find((p) => approx(p.t, 3 - 1e-4, 1e-6));
    const at = series.find((p) => p.t === 3);
    expect(before?.v).toBe(0); // excludes the dose
    expect(at?.v).toBe(50); // includes the dose
  });

  it("never emits a dose-to-take field (descriptive output only)", () => {
    const ss = steadyState(8, { perDose: 65, intervalDays: 7 / 3 });
    expect(Object.keys(ss).sort()).toEqual(["avg", "k", "peak", "trough"]);
  });

  it("steady plateau is higher than the per-period (weekly) input dose", () => {
    // testosterone: 195 mg/week input, plateau ≈ 320 mg on board (§1.3)
    const ss = steadyState(8, { perDose: 65, intervalDays: 7 / 3 });
    expect(ss.avg).toBeGreaterThan(195);
  });
});
