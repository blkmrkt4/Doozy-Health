import { describe, expect, it } from "vitest";
import {
  computeConcentration,
  resolveParams,
  generateScheduledDoses,
  type PkParams,
  type DoseEvent,
} from "@/lib/pharmacokinetics";

// Deterministic PK engine tests (PRD §5.7, §15).
// Pure math — no Supabase stack needed.

const MS_PER_HOUR = 3_600_000;

// A simple drug: 6-hour half-life, 100% bioavailability, 2-hour Tmax.
const SIMPLE_PARAMS: PkParams = {
  halfLifeHours: 6,
  bioavailability: 1.0,
  tmaxHours: 2,
};

const NOW = Date.now();
const DAY_MS = 24 * MS_PER_HOUR;

describe("computeConcentration", () => {
  it("returns a flat line at 0 with no doses", () => {
    const result = computeConcentration(
      [],
      SIMPLE_PARAMS,
      NOW - DAY_MS,
      NOW + DAY_MS,
      NOW
    );
    expect(result.points.length).toBeGreaterThan(0);
    for (const p of result.points) {
      expect(p.concentration).toBe(0);
    }
    expect(result.doseMarkers).toHaveLength(0);
  });

  it("single dose peaks near Tmax", () => {
    const doseTime = NOW - 12 * MS_PER_HOUR; // 12 hours ago
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];

    const result = computeConcentration(
      doses,
      SIMPLE_PARAMS,
      doseTime - MS_PER_HOUR,
      NOW + MS_PER_HOUR,
      NOW
    );

    // Find the peak.
    let peakPoint = result.points[0];
    for (const p of result.points) {
      if (p.concentration > peakPoint.concentration) peakPoint = p;
    }

    // Peak should be near doseTime + Tmax (within 1 step).
    const peakHoursAfterDose = (peakPoint.timestamp - doseTime) / MS_PER_HOUR;
    expect(peakHoursAfterDose).toBeCloseTo(SIMPLE_PARAMS.tmaxHours, 0);

    // Peak concentration should be approximately effectiveDose (100 * 1.0).
    expect(peakPoint.concentration).toBeCloseTo(100, 0);
  });

  it("concentration decays with the correct half-life", () => {
    const doseTime = NOW - 24 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];

    const result = computeConcentration(
      doses,
      SIMPLE_PARAMS,
      doseTime,
      NOW,
      NOW,
      MS_PER_HOUR
    );

    // At Tmax (2h): peak ≈ 100
    const atTmax = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 2 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;

    // At Tmax + 6h (one half-life): ≈ 50
    const atOneHL = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 8 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;

    // At Tmax + 12h (two half-lives): ≈ 25
    const atTwoHL = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 14 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;

    expect(atTmax.concentration).toBeCloseTo(100, -1);
    expect(atOneHL.concentration).toBeCloseTo(50, -1);
    expect(atTwoHL.concentration).toBeCloseTo(25, -1);
  });

  it("superposition: two doses produce higher concentration than one", () => {
    const dose1 = NOW - 8 * MS_PER_HOUR;
    const dose2 = NOW - 2 * MS_PER_HOUR;

    const single = computeConcentration(
      [{ timestamp: dose2, amount: 100 }],
      SIMPLE_PARAMS,
      NOW - 12 * MS_PER_HOUR,
      NOW + 4 * MS_PER_HOUR,
      NOW
    );

    const double = computeConcentration(
      [
        { timestamp: dose1, amount: 100 },
        { timestamp: dose2, amount: 100 },
      ],
      SIMPLE_PARAMS,
      NOW - 12 * MS_PER_HOUR,
      NOW + 4 * MS_PER_HOUR,
      NOW
    );

    // At the "now" point, double should be higher than single.
    const singleNow = single.points[single.nowIndex].concentration;
    const doubleNow = double.points[double.nowIndex].concentration;
    expect(doubleNow).toBeGreaterThan(singleNow);
  });

  it("bioavailability < 1 scales the concentration", () => {
    const lowBio: PkParams = { ...SIMPLE_PARAMS, bioavailability: 0.5 };
    const doseTime = NOW - 4 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];

    const full = computeConcentration(
      doses,
      SIMPLE_PARAMS,
      doseTime,
      NOW,
      NOW
    );
    const half = computeConcentration(
      doses,
      lowBio,
      doseTime,
      NOW,
      NOW
    );

    // At the same time point, the 0.5 bioavailability should be ~half.
    const fullNow = full.points[full.nowIndex].concentration;
    const halfNow = half.points[half.nowIndex].concentration;
    expect(halfNow).toBeCloseTo(fullNow * 0.5, 0);
  });

  it("dose markers include only doses within the range", () => {
    const inRange = NOW - 2 * MS_PER_HOUR;
    const outOfRange = NOW - 20 * DAY_MS; // way before the window

    const result = computeConcentration(
      [
        { timestamp: outOfRange, amount: 50 },
        { timestamp: inRange, amount: 100 },
      ],
      SIMPLE_PARAMS,
      NOW - DAY_MS,
      NOW + DAY_MS,
      NOW
    );

    expect(result.doseMarkers).toHaveLength(1);
    expect(result.doseMarkers[0].timestamp).toBe(inRange);
  });

  it("nowIndex points to the closest time step to now", () => {
    const result = computeConcentration(
      [],
      SIMPLE_PARAMS,
      NOW - DAY_MS,
      NOW + DAY_MS,
      NOW
    );

    const nowPoint = result.points[result.nowIndex];
    const dist = Math.abs(nowPoint.timestamp - NOW);
    expect(dist).toBeLessThanOrEqual(MS_PER_HOUR);
  });
});

describe("resolveParams", () => {
  const drug = {
    half_life_hours: { oral: 6, intramuscular: 192 },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 2, intramuscular: 96 },
  };

  it("resolves oral params correctly", () => {
    const params = resolveParams(drug, "oral");
    expect(params).toEqual({
      halfLifeHours: 6,
      bioavailability: 0.7,
      tmaxHours: 2,
    });
  });

  it("resolves IM params with default bioavailability", () => {
    const params = resolveParams(drug, "intramuscular");
    expect(params).toEqual({
      halfLifeHours: 192,
      bioavailability: 1.0, // defaults when not specified
      tmaxHours: 96,
    });
  });

  it("returns null for unknown route", () => {
    expect(resolveParams(drug, "transdermal")).toBeNull();
  });

  it("returns null for empty half_life_hours", () => {
    expect(resolveParams({ half_life_hours: {} }, "oral")).toBeNull();
  });
});

describe("generateScheduledDoses", () => {
  it("generates doses for 'every' frequency", () => {
    const start = NOW;
    const end = NOW + 3 * DAY_MS;

    const doses = generateScheduledDoses(
      { type: "every", interval: 1, unit: "day" },
      100,
      start,
      end
    );

    // 3 days → 4 doses (at start, +1d, +2d, +3d).
    expect(doses).toHaveLength(4);
    expect(doses[0].amount).toBe(100);
    expect(doses[1].timestamp - doses[0].timestamp).toBe(DAY_MS);
  });

  it("generates doses for 'times_per' frequency", () => {
    const doses = generateScheduledDoses(
      { type: "times_per", count: 2, period: "day" },
      50,
      NOW,
      NOW + DAY_MS
    );

    // 2x/day over 1 day = every 12h → 3 doses (at 0h, 12h, 24h).
    expect(doses).toHaveLength(3);
  });

  it("returns empty for 'as_needed'", () => {
    expect(
      generateScheduledDoses({ type: "as_needed" }, 100, NOW, NOW + DAY_MS)
    ).toHaveLength(0);
  });
});
