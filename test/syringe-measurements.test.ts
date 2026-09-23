import { describe, expect, it } from "vitest";
import { formatNeedleLength, parseNeedleLength, parseNeedleGauge, parseSyringeCapacity, readSyringeMeasurements } from "@/lib/syringe-measurements";

describe("package measurements", () => {
  it.each(["5/8", "5 / 8", "⅝", "5⁄8", "0.625", '5/8"', "5/8 in", "5/8 inches"])("accepts %s as five eighths of an inch", (text) => {
    expect(parseNeedleLength(text)).toBe(0.625);
  });
  it.each(["1 1/2", "1½", "1 ½"])("accepts mixed fractions: %s", (text) => {
    expect(parseNeedleLength(text)).toBe(1.5);
  });
  it("converts metric length without replacing it with a nearby nominal inch size", () => {
    expect(parseNeedleLength("15.875", "mm")).toBeCloseTo(0.625, 12);
    expect(parseNeedleLength("16 mm")).toBeCloseTo(16 / 25.4, 12);
    expect(parseNeedleLength("16", "mm")).not.toBe(0.625);
    expect(parseNeedleLength('5/8"', "mm")).toBe(0.625);
  });
  it.each(["", "0", "-5/8", "1/0", "5//8", "5/8/2", "NaN", "Infinity", "5/8 bananas", "1e3"])("rejects invalid length %s", (text) => {
    expect(parseNeedleLength(text)).toBeNull();
  });
  it("rejects unknown unit selections", () => {
    expect(parseNeedleLength("5", "cm")).toBeNull();
  });
  it("accepts package capacity and gauge suffixes", () => {
    expect(parseSyringeCapacity("1 mL")).toBe(1);
    expect(parseSyringeCapacity("1 cc")).toBe(1);
    expect(parseNeedleGauge("25G")).toBe(25);
    expect(parseNeedleGauge("25 g")).toBe(25);
    expect(parseNeedleGauge("25.5G")).toBeNull();
    expect(parseNeedleGauge("25mm")).toBeNull();
  });
  it("shows both length units with a familiar fraction", () => {
    expect(formatNeedleLength(0.625)).toBe("5/8 in (15.875 mm)");
    expect(formatNeedleLength(1.5)).toBe("1 1/2 in (38.1 mm)");
    expect(formatNeedleLength(16 / 25.4)).toBe("approximately 0.629921 in (16 mm)");
  });
});

describe("syringe form parsing", () => {
  it.each(["", "syringe_"])("normalizes fields for prefix '%s'", (prefix) => {
    const fd = new FormData();
    for (const [key, value] of Object.entries({ capacity_ml: "1 mL", needle_gauge: "25G", needle_length: "5/8", needle_length_unit: "in", unit_markings: "0.1 mL" })) fd.set(prefix + key, value);
    expect(readSyringeMeasurements(fd, prefix)).toEqual({ errors: {}, spec: { capacity_mL: 1, needle_gauge: 25, needle_length_in: 0.625, unit_markings: "0.1 mL" } });
    fd.set(prefix + "needle_length", "16");
    fd.set(prefix + "needle_length_unit", "mm");
    expect(readSyringeMeasurements(fd, prefix).spec.needle_length_in).toBeCloseTo(16 / 25.4);
  });
  it("still accepts older decimal-inch forms", () => {
    const fd = new FormData();
    fd.set("needle_length_in", "0.625");
    expect(readSyringeMeasurements(fd).spec.needle_length_in).toBe(0.625);
  });
  it("validates raw entry instead of trusting an old or forged normalized field", () => {
    const fd = new FormData();
    fd.set("needle_length_in", "0.625");
    fd.set("needle_length", "1/0");
    expect(readSyringeMeasurements(fd).errors.length).toBeTruthy();
    expect(readSyringeMeasurements(fd).spec.needle_length_in).toBeUndefined();
  });
  it("keeps optional blank fields absent, but does not silently lose invalid ones", () => {
    const fd = new FormData();
    expect(readSyringeMeasurements(fd)).toEqual({ spec: {}, errors: {} });
    fd.set("capacity_ml", "bad");
    fd.set("needle_gauge", "25.5");
    fd.set("needle_length", "5/0");
    expect(Object.keys(readSyringeMeasurements(fd).errors)).toEqual(["capacity", "gauge", "length"]);
  });
  it("requires capacity when medication details would otherwise be discarded", () => {
    const fd = new FormData();
    fd.set("syringe_needle_length", "5/8");
    expect(readSyringeMeasurements(fd, "syringe_", true).errors.capacity).toBeTruthy();
  });
});
