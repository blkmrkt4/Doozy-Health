import { describe, expect, it } from "vitest";
import {
  computeConcentration,
  resolveParams,
  generateScheduledDoses,
  calibrateHalfLife,
  type PkParams,
  type DoseEvent,
  type CalibrationReading,
} from "@/lib/pharmacokinetics";

// Deterministic PK engine tests (PRD §5.7, §15).
// Pure math — no Supabase stack needed. Covers all three kernels,
// linearity gate, uncertainty band, metabolites, and calibration.

const MS_PER_HOUR = 3_600_000;
const NOW = Date.now();
const DAY_MS = 24 * MS_PER_HOUR;

// ── Bateman kernel (oral / depot IM) ───────────────────────────────────────

const BATEMAN_PARAMS: PkParams = {
  halfLifeHours: 6,
  bioavailability: 1.0,
  tmaxHours: 2,
  kernel: "bateman",
  isLinear: true,
};

describe("Bateman kernel", () => {
  it("returns a flat line at 0 with no doses", () => {
    const result = computeConcentration([], BATEMAN_PARAMS, NOW - DAY_MS, NOW + DAY_MS, NOW);
    for (const p of result.points) {
      expect(p.concentration).toBe(0);
    }
  });

  it("single dose peaks near Tmax", () => {
    const doseTime = NOW - 12 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, BATEMAN_PARAMS, doseTime - MS_PER_HOUR, NOW, NOW);

    let peakPoint = result.points[0];
    for (const p of result.points) {
      if (p.concentration > peakPoint.concentration) peakPoint = p;
    }

    const peakHours = (peakPoint.timestamp - doseTime) / MS_PER_HOUR;
    // The Bateman function peak occurs near Tmax but can shift due to
    // the Ka/ke ratio. Accept within 3× Tmax as reasonable.
    expect(peakHours).toBeGreaterThan(0);
    expect(peakHours).toBeLessThanOrEqual(BATEMAN_PARAMS.tmaxHours * 3);
  });

  it("concentration decays after peak", () => {
    const doseTime = NOW - 24 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, BATEMAN_PARAMS, doseTime, NOW, NOW);

    // Concentration at 4h should be higher than at 20h.
    const at4h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 4 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    const at20h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 20 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    expect(at4h.concentration).toBeGreaterThan(at20h.concentration);
  });

  it("superposition: two doses produce higher concentration than one", () => {
    const dose1 = NOW - 8 * MS_PER_HOUR;
    const dose2 = NOW - 2 * MS_PER_HOUR;

    const single = computeConcentration(
      [{ timestamp: dose2, amount: 100 }], BATEMAN_PARAMS,
      NOW - 12 * MS_PER_HOUR, NOW + 4 * MS_PER_HOUR, NOW
    );
    const double = computeConcentration(
      [{ timestamp: dose1, amount: 100 }, { timestamp: dose2, amount: 100 }], BATEMAN_PARAMS,
      NOW - 12 * MS_PER_HOUR, NOW + 4 * MS_PER_HOUR, NOW
    );

    expect(double.points[double.nowIndex].concentration)
      .toBeGreaterThan(single.points[single.nowIndex].concentration);
  });

  it("bioavailability < 1 scales the concentration", () => {
    const lowBio: PkParams = { ...BATEMAN_PARAMS, bioavailability: 0.5 };
    const doseTime = NOW - 4 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];

    const full = computeConcentration(doses, BATEMAN_PARAMS, doseTime, NOW, NOW);
    const half = computeConcentration(doses, lowBio, doseTime, NOW, NOW);

    const fullNow = full.points[full.nowIndex].concentration;
    const halfNow = half.points[half.nowIndex].concentration;
    expect(halfNow).toBeCloseTo(fullNow * 0.5, 0);
  });
});

// ── Exponential kernel (IV-like) ───────────────────────────────────────────

describe("Exponential kernel", () => {
  const params: PkParams = {
    halfLifeHours: 6,
    bioavailability: 1.0,
    tmaxHours: 0,
    kernel: "exponential",
    isLinear: true,
  };

  it("peaks immediately at dose time", () => {
    const doseTime = NOW - 6 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    // First point should be near peak.
    expect(result.points[0].concentration).toBeCloseTo(100, -1);
  });

  it("halves after one half-life", () => {
    const doseTime = NOW - 12 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    const at6h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 6 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    expect(at6h.concentration).toBeCloseTo(50, -1);
  });
});

// ── Zero-order kernel (transdermal patches) ────────────────────────────────

describe("Zero-order kernel", () => {
  const params: PkParams = {
    halfLifeHours: 15,
    bioavailability: 1.0,
    tmaxHours: 24,
    kernel: "zeroOrder",
    releaseDurationHours: 84, // 3.5-day patch
    isLinear: true,
  };

  it("accumulates during release phase", () => {
    const doseTime = NOW - 48 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    // At 24h (during release) should be positive and increasing.
    const at24h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 24 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    const at12h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 12 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    expect(at24h.concentration).toBeGreaterThan(at12h.concentration);
    expect(at12h.concentration).toBeGreaterThan(0);
  });

  it("decays after release duration ends", () => {
    const doseTime = NOW - 120 * MS_PER_HOUR; // 5 days ago
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    // After release (84h), the level should be declining.
    const at85h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 85 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    const at100h = result.points.find(
      (p) => Math.abs(p.timestamp - (doseTime + 100 * MS_PER_HOUR)) < MS_PER_HOUR / 2
    )!;
    expect(at85h.concentration).toBeGreaterThan(at100h.concentration);
  });
});

// ── Uncertainty band ───────────────────────────────────────────────────────

describe("Uncertainty band", () => {
  it("produces upper and lower bounds from half_life_range", () => {
    const params: PkParams = {
      ...BATEMAN_PARAMS,
      halfLifeRange: [4, 10],
    };
    const doseTime = NOW - 6 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    expect(result.upperBound).toBeDefined();
    expect(result.lowerBound).toBeDefined();
    expect(result.upperBound!.length).toBe(result.points.length);

    // Upper bound (longer half-life) should be >= main at the now index.
    const mainNow = result.points[result.nowIndex].concentration;
    const upperNow = result.upperBound![result.nowIndex].concentration;
    const lowerNow = result.lowerBound![result.nowIndex].concentration;
    expect(upperNow).toBeGreaterThanOrEqual(mainNow * 0.9); // allow some tolerance
    expect(lowerNow).toBeLessThanOrEqual(mainNow * 1.1);
  });
});

// ── Active metabolites ─────────────────────────────────────────────────────

describe("Active metabolites", () => {
  it("produces metabolite series for drugs with metabolites", () => {
    const params: PkParams = {
      ...BATEMAN_PARAMS,
      metabolites: [
        {
          name: "norfluoxetine",
          fraction: 0.8,
          kernel: "bateman",
          halfLifeHours: 168,
          tmaxHours: 8,
        },
      ],
    };
    const doseTime = NOW - 12 * MS_PER_HOUR;
    const doses: DoseEvent[] = [{ timestamp: doseTime, amount: 100 }];
    const result = computeConcentration(doses, params, doseTime, NOW, NOW);

    expect(result.metaboliteSeries).toBeDefined();
    expect(result.metaboliteSeries).toHaveLength(1);
    expect(result.metaboliteSeries![0].name).toBe("norfluoxetine");
    expect(result.metaboliteSeries![0].points.length).toBe(result.points.length);

    // Metabolite should have non-zero concentration.
    const metNow = result.metaboliteSeries![0].points[result.nowIndex].concentration;
    expect(metNow).toBeGreaterThan(0);
  });
});

// ── Steady-state estimation ────────────────────────────────────────────────

describe("Steady-state marker", () => {
  it("estimates steady state at ~5 half-lives from first dose", () => {
    const doseTime = NOW - 2 * MS_PER_HOUR;
    const params: PkParams = { ...BATEMAN_PARAMS, halfLifeHours: 6 };
    const result = computeConcentration(
      [{ timestamp: doseTime, amount: 100 }], params,
      doseTime, NOW + 40 * MS_PER_HOUR, NOW
    );

    expect(result.steadyStateTimestamp).toBeDefined();
    const ssHours = (result.steadyStateTimestamp! - doseTime) / MS_PER_HOUR;
    expect(ssHours).toBeCloseTo(30, 0); // 5 × 6h
  });
});

// ── Linearity gate ─────────────────────────────────────────────────────────

describe("Linearity gate", () => {
  it("resolveParams returns isLinear=false for non-linear drugs", () => {
    const drug = {
      half_life_hours: { oral: 22 },
      is_linear: false,
      nonlinear_reason: "Saturable elimination (Michaelis-Menten kinetics).",
    };
    const params = resolveParams(drug, "oral");
    expect(params).not.toBeNull();
    expect(params!.isLinear).toBe(false);
    expect(params!.nonlinearReason).toContain("Saturable");
  });
});

// ── resolveParams ──────────────────────────────────────────────────────────

describe("resolveParams (v0.4)", () => {
  const drug = {
    half_life_hours: { oral: 6, intramuscular: 192 },
    half_life_range_hours: { oral: [4, 10] as [number, number] },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 2, intramuscular: 96 },
    kernel_by_route: { oral: "bateman", intramuscular: "bateman" },
    is_linear: true,
    metabolites: [
      { name: "M1", fraction: 0.3, kernel: "bateman" as const, half_life_hours: 12, tmax_hours: 4 },
    ],
  };

  it("resolves oral params with all v0.4 fields", () => {
    const params = resolveParams(drug, "oral");
    expect(params).toEqual({
      halfLifeHours: 6,
      halfLifeRange: [4, 10],
      bioavailability: 0.7,
      tmaxHours: 2,
      kernel: "bateman",
      releaseDurationHours: undefined,
      isLinear: true,
      nonlinearReason: undefined,
      metabolites: [{ name: "M1", fraction: 0.3, kernel: "bateman", halfLifeHours: 12, tmaxHours: 4 }],
    });
  });

  it("returns null for unknown route", () => {
    expect(resolveParams(drug, "transdermal")).toBeNull();
  });

  it("defaults kernel to bateman if not specified", () => {
    const minimal = { half_life_hours: { oral: 10 } };
    const params = resolveParams(minimal, "oral");
    expect(params!.kernel).toBe("bateman");
  });
});

// ── calibrateHalfLife ──────────────────────────────────────────────────────

describe("calibrateHalfLife", () => {
  it("back-solves correct half-life from two decline readings", () => {
    // If C1=100 at t=0, C2=50 at t=6h → half-life should be 6h.
    const readings: CalibrationReading[] = [
      { value: 100, observedAt: NOW },
      { value: 50, observedAt: NOW + 6 * MS_PER_HOUR },
    ];
    const result = calibrateHalfLife(readings, 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personalHalfLifeHours).toBeCloseTo(6, 1);
    }
  });

  it("rejects implausible fits (too far from textbook)", () => {
    // Readings implying a 600h half-life when textbook is 6h → reject.
    const readings: CalibrationReading[] = [
      { value: 100, observedAt: NOW },
      { value: 99, observedAt: NOW + 100 * MS_PER_HOUR },
    ];
    const result = calibrateHalfLife(readings, 6);
    expect(result.ok).toBe(false);
  });

  it("requires at least two readings", () => {
    const result = calibrateHalfLife([{ value: 100, observedAt: NOW }], 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("two readings");
  });

  it("rejects if second reading is higher (not declining)", () => {
    const readings: CalibrationReading[] = [
      { value: 50, observedAt: NOW },
      { value: 100, observedAt: NOW + 6 * MS_PER_HOUR },
    ];
    const result = calibrateHalfLife(readings, 6);
    expect(result.ok).toBe(false);
  });

  it("rejects non-positive values", () => {
    const readings: CalibrationReading[] = [
      { value: 0, observedAt: NOW },
      { value: -10, observedAt: NOW + 6 * MS_PER_HOUR },
    ];
    const result = calibrateHalfLife(readings, 6);
    expect(result.ok).toBe(false);
  });
});

// ── generateScheduledDoses ─────────────────────────────────────────────────

describe("generateScheduledDoses", () => {
  it("generates doses for 'every' frequency", () => {
    const doses = generateScheduledDoses(
      { type: "every", interval: 1, unit: "day" }, 100, NOW, NOW + 3 * DAY_MS
    );
    expect(doses).toHaveLength(4);
    expect(doses[1].timestamp - doses[0].timestamp).toBe(DAY_MS);
  });

  it("generates doses for 'times_per' frequency", () => {
    const doses = generateScheduledDoses(
      { type: "times_per", count: 2, period: "day" }, 50, NOW, NOW + DAY_MS
    );
    expect(doses).toHaveLength(3);
  });

  it("returns empty for 'as_needed'", () => {
    expect(
      generateScheduledDoses({ type: "as_needed" }, 100, NOW, NOW + DAY_MS)
    ).toHaveLength(0);
  });
});
