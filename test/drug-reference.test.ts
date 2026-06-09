import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Self-populating drug reference (PRD §5.7).
 *
 * The LLM and the service-role admin client are mocked at their module
 * boundaries — no live OpenRouter (PRD §15), no live Supabase. Tests cover:
 *  - the lookup-JSON parser (valid → values, decline/garbage → null, half-life
 *    ≤ 0 rejected, kernel/range/bioavailability validation),
 *  - the per-route map builder,
 *  - provenance derivation,
 *  - the resolver: pure cache hit (no LLM), miss → insert, route-missing →
 *    merge without clobbering other routes, and the concurrent-insert race
 *    (UNIQUE conflict → re-read + merge, no duplicate).
 */

// ── Mock llmCall (the only LLM boundary this module touches) ────────────────
const llmCall = vi.fn();
vi.mock("@/lib/llm", () => ({ llmCall: (...a: unknown[]) => llmCall(...a) }));

// ── In-memory fake of the service-role admin client ─────────────────────────
type Row = Record<string, unknown> & { id: string; canonical_name: string };

const store = new Map<string, Row>(); // keyed by id
let idSeq = 0;
let insertCount = 0;

function rowByName(name: string): Row | undefined {
  const lc = name.toLowerCase();
  for (const r of store.values()) {
    if (String(r.canonical_name).toLowerCase() === lc) return r;
  }
  return undefined;
}

// A minimal chainable query builder covering exactly the calls drug-reference
// makes: select.eq.maybeSingle, select.ilike.maybeSingle, insert.select.single,
// update.eq.
function from(_table: string) {
  return {
    select() {
      return {
        eq(_col: string, id: string) {
          return {
            async maybeSingle() {
              return { data: store.get(id) ?? null, error: null };
            },
          };
        },
        ilike(_col: string, name: string) {
          return {
            async maybeSingle() {
              return { data: rowByName(name) ?? null, error: null };
            },
          };
        },
      };
    },
    insert(obj: Record<string, unknown>) {
      return {
        select() {
          return {
            async single() {
              insertCount += 1;
              const name = String(obj.canonical_name);
              if (rowByName(name)) {
                // Simulate the UNIQUE(canonical_name) violation on a race.
                return { data: null, error: { message: "duplicate key" } };
              }
              const id = `drug-${++idSeq}`;
              const row = { ...obj, id } as Row;
              store.set(id, row);
              return { data: { id }, error: null };
            },
          };
        },
      };
    },
    update(patch: Record<string, unknown>) {
      return {
        async eq(_col: string, id: string) {
          const cur = store.get(id);
          if (cur) store.set(id, { ...cur, ...patch });
          return { error: null };
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

import {
  parseDrugPkLookup,
  routeMapsFrom,
  resolveOrCreateCanonicalDrug,
  LLM_ESTIMATED_SOURCE,
} from "@/lib/drug-reference";
import { provenanceFromReferenceData } from "@/lib/pk/amountInSystem";

function ok(text: string) {
  return { ok: true as const, text };
}

const PROGESTERONE = JSON.stringify({
  canonical_name: "Progesterone",
  atc_class: "G03DA04",
  controlled_schedule: "",
  is_linear: true,
  half_life_hours: 12,
  half_life_range_hours: [8, 16],
  bioavailability: 0.1,
  tmax_hours: 6,
  kernel: "zeroOrder",
  release_duration_hours: 24,
});

beforeEach(() => {
  store.clear();
  idSeq = 0;
  insertCount = 0;
  llmCall.mockReset();
});

describe("parseDrugPkLookup", () => {
  it("parses a full valid response and lowercases the canonical name", () => {
    const pk = parseDrugPkLookup(PROGESTERONE, "fallback");
    expect(pk).not.toBeNull();
    expect(pk!.canonicalName).toBe("progesterone");
    expect(pk!.halfLifeHours).toBe(12);
    expect(pk!.halfLifeRange).toEqual([8, 16]);
    expect(pk!.bioavailability).toBe(0.1);
    expect(pk!.kernel).toBe("zeroOrder");
    expect(pk!.releaseDurationHours).toBe(24);
    expect(pk!.isLinear).toBe(true);
  });

  it("tolerates code fences and surrounding prose", () => {
    const fenced = "```json\n" + PROGESTERONE + "\n```";
    expect(parseDrugPkLookup(fenced, "x")?.canonicalName).toBe("progesterone");
  });

  it("returns null when the model declines with {unknown:true}", () => {
    expect(parseDrugPkLookup('{"unknown": true}', "x")).toBeNull();
  });

  it("rejects a non-positive or missing half-life (don't cache junk)", () => {
    expect(parseDrugPkLookup('{"half_life_hours": 0}', "x")).toBeNull();
    expect(parseDrugPkLookup('{"half_life_hours": -3}', "x")).toBeNull();
    expect(parseDrugPkLookup('{"canonical_name":"a"}', "x")).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseDrugPkLookup("not json at all", "x")).toBeNull();
  });

  it("falls back to the fallback name and defaults an unknown kernel to bateman", () => {
    const pk = parseDrugPkLookup('{"half_life_hours": 5, "kernel": "wat"}', "estradiol");
    expect(pk!.canonicalName).toBe("estradiol");
    expect(pk!.kernel).toBe("bateman");
  });

  it("drops an out-of-range bioavailability and a malformed range", () => {
    const pk = parseDrugPkLookup(
      '{"half_life_hours": 5, "bioavailability": 2, "half_life_range_hours": [1,2,3]}',
      "x"
    );
    expect(pk!.bioavailability).toBeUndefined();
    expect(pk!.halfLifeRange).toBeUndefined();
  });
});

describe("routeMapsFrom", () => {
  it("keys every per-route map by the given route", () => {
    const pk = parseDrugPkLookup(PROGESTERONE, "x")!;
    const maps = routeMapsFrom("transdermal", pk);
    expect(maps.half_life_hours).toEqual({ transdermal: 12 });
    expect(maps.kernel_by_route).toEqual({ transdermal: "zeroOrder" });
    expect(maps.half_life_range_hours).toEqual({ transdermal: [8, 16] });
    expect(maps.tmax_hours).toEqual({ transdermal: 6 });
    expect(maps.release_duration_hours).toEqual({ transdermal: 24 });
  });
});

describe("provenanceFromReferenceData", () => {
  it("maps the llm_estimated source to the llm_estimated provenance", () => {
    expect(provenanceFromReferenceData({ source: LLM_ESTIMATED_SOURCE })).toBe(
      "llm_estimated"
    );
  });
  it("treats anything else (curated catalogue, null) as curated", () => {
    expect(provenanceFromReferenceData({ source: "textbook PK" })).toBe("curated");
    expect(provenanceFromReferenceData(null)).toBe("curated");
    expect(provenanceFromReferenceData(undefined)).toBe("curated");
  });
});

describe("resolveOrCreateCanonicalDrug", () => {
  it("is a pure cache hit (no LLM) when the matched row already has the route", async () => {
    store.set("drug-x", {
      id: "drug-x",
      canonical_name: "progesterone",
      half_life_hours: { transdermal: 12 },
    });
    const id = await resolveOrCreateCanonicalDrug({
      name: "Progesterone",
      route: "transdermal",
      canonicalDrugId: "drug-x",
    });
    expect(id).toBe("drug-x");
    expect(llmCall).not.toHaveBeenCalled();
  });

  it("looks up + inserts an llm_estimated row on a full miss", async () => {
    llmCall.mockResolvedValue(ok(PROGESTERONE));
    const id = await resolveOrCreateCanonicalDrug({
      name: "Progesterone",
      route: "transdermal",
    });
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(id).not.toBeNull();
    const row = store.get(id!)!;
    expect((row.reference_data as { source: string }).source).toBe(LLM_ESTIMATED_SOURCE);
    expect(row.half_life_hours).toEqual({ transdermal: 12 });
    expect(row.is_linear).toBe(true);
  });

  it("merges a new route into an existing row without clobbering the other route", async () => {
    store.set("drug-p", {
      id: "drug-p",
      canonical_name: "progesterone",
      half_life_hours: { transdermal: 12 },
      kernel_by_route: { transdermal: "zeroOrder" },
    });
    llmCall.mockResolvedValue(
      ok(JSON.stringify({ half_life_hours: 18, kernel: "bateman" }))
    );
    const id = await resolveOrCreateCanonicalDrug({
      name: "progesterone",
      route: "oral",
      canonicalDrugId: "drug-p",
    });
    expect(id).toBe("drug-p");
    const row = store.get("drug-p")!;
    // Both routes present — the transdermal values survive.
    expect(row.half_life_hours).toEqual({ transdermal: 12, oral: 18 });
    expect(row.kernel_by_route).toEqual({ transdermal: "zeroOrder", oral: "bateman" });
  });

  it("returns null (no row, save unblocked) when the model declines", async () => {
    llmCall.mockResolvedValue(ok('{"unknown": true}'));
    const id = await resolveOrCreateCanonicalDrug({ name: "madeupium", route: "oral" });
    expect(id).toBeNull();
    expect(store.size).toBe(0);
  });

  it("returns null when the LLM call itself fails (never blocks the save)", async () => {
    llmCall.mockResolvedValue({ ok: false, error: "timeout" });
    const id = await resolveOrCreateCanonicalDrug({ name: "x", route: "oral" });
    expect(id).toBeNull();
  });

  it("recovers from a concurrent-insert race by re-reading and merging", async () => {
    // Simulate the loser of an insert race: a row for the same canonical name
    // already exists by the time we try to insert. The resolver should detect
    // the conflict, re-read, merge its route, and return the existing id —
    // never a duplicate.
    llmCall.mockImplementation(async () => {
      // Another writer wins the race between our cache-miss read and our insert.
      if (!rowByName("progesterone")) {
        store.set("winner", {
          id: "winner",
          canonical_name: "progesterone",
          half_life_hours: { oral: 9 },
        });
      }
      return ok(PROGESTERONE); // our lookup is transdermal
    });
    const id = await resolveOrCreateCanonicalDrug({
      name: "progesterone",
      route: "transdermal",
    });
    expect(id).toBe("winner");
    expect(store.size).toBe(1); // no duplicate row
    const row = store.get("winner")!;
    expect(row.half_life_hours).toEqual({ oral: 9, transdermal: 12 }); // merged
  });
});
