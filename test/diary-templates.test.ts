import { describe, it, expect } from "vitest";
import {
  DIARY_TEMPLATES,
  templatesForDrug,
  templateById,
  galleryTemplates,
  audienceMatches,
  ageFromDob,
  templateFieldRows,
  type DiaryTemplate,
} from "@/lib/diary-templates";
import { FIELD_TYPES } from "@/lib/types";

const allFields = (t: DiaryTemplate) => [
  ...t.coreFields,
  ...t.optionalFields,
  ...(t.periodicFields ?? []),
];

describe("DIARY_TEMPLATES catalogue invariants", () => {
  it("ships ~10 launch templates with unique ids", () => {
    expect(DIARY_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(DIARY_TEMPLATES.length).toBeLessThanOrEqual(14);
    const ids = DIARY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps every core set at 8 fields (survey-fatigue rule)", () => {
    for (const t of DIARY_TEMPLATES) {
      expect(t.coreFields.length, t.id).toBeLessThanOrEqual(8);
      expect(t.coreFields.length, t.id).toBeGreaterThan(0);
    }
  });

  it("uses only valid field types", () => {
    for (const t of DIARY_TEMPLATES) {
      for (const f of allFields(t)) {
        expect(FIELD_TYPES as readonly string[], `${t.id}/${f.name}`).toContain(
          f.field_type
        );
      }
    }
  });

  it("gives category/multiselect fields non-empty options, and others none", () => {
    for (const t of DIARY_TEMPLATES) {
      for (const f of allFields(t)) {
        if (f.field_type === "category" || f.field_type === "multiselect") {
          expect(f.category_options?.length, `${t.id}/${f.name}`).toBeGreaterThan(0);
        } else {
          expect(f.category_options, `${t.id}/${f.name}`).toBeUndefined();
        }
      }
    }
  });

  it("keeps matchTerms lowercase on medication templates", () => {
    for (const t of DIARY_TEMPLATES.filter((t) => t.kind === "medication")) {
      expect((t.matchTerms ?? []).length, t.id).toBeGreaterThan(0);
      for (const term of t.matchTerms ?? []) {
        expect(term, t.id).toBe(term.toLowerCase());
      }
    }
  });

  it("has no duplicate field names within a single template", () => {
    for (const t of DIARY_TEMPLATES) {
      const names = allFields(t).map((f) => f.name.toLowerCase());
      expect(new Set(names).size, t.id).toBe(names.length);
    }
  });
});

describe("templatesForDrug", () => {
  it("matches a GLP-1 by generic name (substring either way)", () => {
    expect(templatesForDrug("semaglutide").map((t) => t.id)).toContain("glp1-weight");
    expect(templatesForDrug("testosterone cypionate").map((t) => t.id)).toContain("trt-male");
    expect(templatesForDrug("Estradiol").map((t) => t.id)).toContain("menopause-hrt");
  });
  it("returns nothing for an unknown drug or empty name", () => {
    expect(templatesForDrug("madeupium")).toEqual([]);
    expect(templatesForDrug("")).toEqual([]);
    expect(templatesForDrug(null)).toEqual([]);
  });
});

describe("audience filtering", () => {
  it("hides a sex-specific template for the mismatched sex", () => {
    const menopause = templateById("menopause-hrt")!;
    expect(audienceMatches(menopause, { sex: "male" })).toBe(false);
    expect(audienceMatches(menopause, { sex: "female" })).toBe(true);
  });
  it("shows everything when sex is unknown", () => {
    const trt = templateById("trt-male")!;
    expect(audienceMatches(trt, { sex: null })).toBe(true);
    expect(audienceMatches(trt, {})).toBe(true);
  });
  it("galleryTemplates drops mismatched-sex templates only when sex is set", () => {
    const maleGallery = galleryTemplates({ sex: "male" });
    expect(maleGallery.map((t) => t.id)).not.toContain("menopause-hrt");
    expect(maleGallery.map((t) => t.id)).not.toContain("cycle-pms");
    const unknown = galleryTemplates({ sex: null });
    expect(unknown.map((t) => t.id)).toContain("menopause-hrt");
  });
  it("respects minAge only when age is known", () => {
    const gated: DiaryTemplate = {
      id: "x", name: "x", kind: "goal", description: "x",
      audience: { minAge: 38 }, coreFields: [], optionalFields: [],
    };
    expect(audienceMatches(gated, { age: 30 })).toBe(false);
    expect(audienceMatches(gated, { age: 40 })).toBe(true);
    expect(audienceMatches(gated, { age: null })).toBe(true);
  });
});

describe("ageFromDob", () => {
  const now = new Date("2026-06-10").getTime();
  it("computes whole-year age", () => {
    expect(ageFromDob("1990-01-01", now)).toBe(36);
    expect(ageFromDob("2020-12-31", now)).toBe(5);
  });
  it("returns null for missing/garbage", () => {
    expect(ageFromDob(null, now)).toBeNull();
    expect(ageFromDob("not-a-date", now)).toBeNull();
  });
});

describe("templateFieldRows", () => {
  it("flags core as checked+daily, optional unchecked+daily, periodic unchecked+periodic", () => {
    const rows = templateFieldRows(templateById("glp1-weight")!);
    const core = rows.filter((r) => r.bucket === "core");
    const periodic = rows.filter((r) => r.bucket === "periodic");
    expect(core.every((r) => r.defaultChecked && r.cadence === "daily")).toBe(true);
    expect(periodic.every((r) => !r.defaultChecked && r.cadence === "periodic")).toBe(true);
    expect(rows.filter((r) => r.bucket === "optional").every((r) => !r.defaultChecked)).toBe(true);
  });
});
