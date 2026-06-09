import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { llmCall } from "@/lib/llm";
import { extractJson } from "@/lib/extraction";
import { logWarn } from "@/lib/log";

// Self-populating central drug reference (PRD §5.7). The `drugs` table is a
// global, per-route PK cache. When a user adds a drug not yet in it, look up the
// published population values ONCE via `lookup_drug_pk` and store the row so every
// future user reuses it — no repeat LLM call (deduped by the UNIQUE canonical_name).
// Hard rule #8: the LLM only LOOKS UP reference values; the curve math stays in
// lib/pharmacokinetics.ts, and these rows are marked `llm_estimated` so the chart
// labels them illustrative. Interactions are NOT touched here (#9 — curated only).

export const LLM_ESTIMATED_SOURCE = "llm_estimated";

type KernelType = "exponential" | "bateman" | "zeroOrder";
const KERNELS = new Set<KernelType>(["exponential", "bateman", "zeroOrder"]);

/** Per-route PK values parsed from a `lookup_drug_pk` response. */
export type DrugPkLookup = {
  canonicalName: string;
  halfLifeHours: number;
  halfLifeRange?: [number, number];
  bioavailability?: number;
  tmaxHours?: number;
  kernel: KernelType;
  releaseDurationHours?: number;
  isLinear: boolean;
  nonlinearReason?: string;
  atcClass?: string;
  controlledSchedule?: string;
};

function finitePos(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse + validate a `lookup_drug_pk` response. Returns null on decline/garbage. */
export function parseDrugPkLookup(raw: string, fallbackName: string): DrugPkLookup | null {
  const obj = extractJson(raw);
  if (!obj || obj.unknown === true) return null;

  const halfLifeHours = finitePos(obj.half_life_hours);
  if (halfLifeHours === null) return null; // no usable half-life → don't cache

  const canonicalName = String(obj.canonical_name ?? fallbackName)
    .trim()
    .toLowerCase();
  if (!canonicalName) return null;

  const kernelRaw = String(obj.kernel ?? "");
  const kernel: KernelType = KERNELS.has(kernelRaw as KernelType)
    ? (kernelRaw as KernelType)
    : "bateman";

  const range = Array.isArray(obj.half_life_range_hours)
    ? obj.half_life_range_hours.map(Number)
    : null;
  const halfLifeRange: [number, number] | undefined =
    range && range.length === 2 && range.every((n) => Number.isFinite(n) && n > 0)
      ? [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
      : undefined;

  const baN = Number(obj.bioavailability);
  const bioavailability =
    Number.isFinite(baN) && baN > 0 && baN <= 1 ? baN : undefined;

  return {
    canonicalName,
    halfLifeHours,
    halfLifeRange,
    bioavailability,
    tmaxHours: finitePos(obj.tmax_hours) ?? undefined,
    kernel,
    releaseDurationHours: finitePos(obj.release_duration_hours) ?? undefined,
    isLinear: obj.is_linear !== false,
    nonlinearReason: obj.nonlinear_reason ? String(obj.nonlinear_reason) : undefined,
    atcClass: obj.atc_class ? String(obj.atc_class) : undefined,
    controlledSchedule: obj.controlled_schedule
      ? String(obj.controlled_schedule)
      : undefined,
  };
}

type RouteMaps = {
  half_life_hours: Record<string, number>;
  half_life_range_hours: Record<string, [number, number]>;
  bioavailability: Record<string, number>;
  tmax_hours: Record<string, number>;
  kernel_by_route: Record<string, string>;
  release_duration_hours: Record<string, number>;
};

/** Build the per-route jsonb maps for one route from a lookup result. */
export function routeMapsFrom(route: string, pk: DrugPkLookup): RouteMaps {
  const m: RouteMaps = {
    half_life_hours: { [route]: pk.halfLifeHours },
    half_life_range_hours: {},
    bioavailability: {},
    tmax_hours: {},
    kernel_by_route: { [route]: pk.kernel },
    release_duration_hours: {},
  };
  if (pk.halfLifeRange) m.half_life_range_hours[route] = pk.halfLifeRange;
  if (pk.bioavailability != null) m.bioavailability[route] = pk.bioavailability;
  if (pk.tmaxHours != null) m.tmax_hours[route] = pk.tmaxHours;
  if (pk.releaseDurationHours != null)
    m.release_duration_hours[route] = pk.releaseDurationHours;
  return m;
}

type DrugRow = {
  id: string;
  canonical_name: string;
  half_life_hours: Record<string, number> | null;
  half_life_range_hours: Record<string, [number, number]> | null;
  bioavailability: Record<string, number> | null;
  tmax_hours: Record<string, number> | null;
  kernel_by_route: Record<string, string> | null;
  release_duration_hours: Record<string, number> | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/** Add a route's maps onto an existing drug row (never clobbering other routes). */
async function mergeRouteIntoRow(admin: Admin, row: DrugRow, maps: RouteMaps): Promise<void> {
  await admin
    .from("drugs")
    .update({
      half_life_hours: { ...(row.half_life_hours ?? {}), ...maps.half_life_hours },
      half_life_range_hours: { ...(row.half_life_range_hours ?? {}), ...maps.half_life_range_hours },
      bioavailability: { ...(row.bioavailability ?? {}), ...maps.bioavailability },
      tmax_hours: { ...(row.tmax_hours ?? {}), ...maps.tmax_hours },
      kernel_by_route: { ...(row.kernel_by_route ?? {}), ...maps.kernel_by_route },
      release_duration_hours: { ...(row.release_duration_hours ?? {}), ...maps.release_duration_hours },
    })
    .eq("id", row.id);
}

const ROW_COLS =
  "id, canonical_name, half_life_hours, half_life_range_hours, bioavailability, tmax_hours, kernel_by_route, release_duration_hours";

/** Look up a drug+route via the LLM and cache it; merge if the canonical already
 *  exists (race-safe via the UNIQUE canonical_name). Returns the drug id or null. */
async function lookupAndStore(
  admin: Admin,
  name: string,
  route: string,
  existing: DrugRow | null
): Promise<string | null> {
  const res = await llmCall("lookup_drug_pk", { drug_name: name, route }, { timeoutMs: 20_000 });
  if (!res.ok) {
    logWarn("drug-reference", "lookup_drug_pk failed", { route, error: res.error });
    return existing?.id ?? null;
  }
  const pk = parseDrugPkLookup(res.text, name);
  if (!pk) return existing?.id ?? null; // declined / unusable → leave canonical unset

  const maps = routeMapsFrom(route, pk);

  if (existing) {
    await mergeRouteIntoRow(admin, existing, maps);
    return existing.id;
  }

  // Insert a new llm_estimated row; on the UNIQUE(canonical_name) race, merge.
  const { data, error } = await admin
    .from("drugs")
    .insert({
      canonical_name: pk.canonicalName,
      atc_class: pk.atcClass ?? null,
      controlled_schedule: pk.controlledSchedule ?? null,
      is_linear: pk.isLinear,
      nonlinear_reason: pk.nonlinearReason ?? null,
      reference_data: { source: LLM_ESTIMATED_SOURCE },
      ...maps,
    })
    .select("id")
    .single();

  if (!error && data) return data.id as string;

  // Lost the insert race (or name already present) → re-read + merge the route.
  const { data: row } = await admin
    .from("drugs")
    .select(ROW_COLS)
    .ilike("canonical_name", pk.canonicalName)
    .maybeSingle();
  if (row) {
    await mergeRouteIntoRow(admin, row as DrugRow, maps);
    return (row as DrugRow).id;
  }
  logWarn("drug-reference", "could not store looked-up drug", { name: pk.canonicalName, error: error?.message });
  return null;
}

/**
 * Resolve the canonical drug for a medication, populating the central cache if
 * needed. Returns the drug id (or null if the drug couldn't be resolved — the
 * medication then simply has no modelled-level chart; nothing is blocked).
 *
 * - Pure cache hit (no LLM): a typeahead-matched row, or a name already in the
 *   cache, that already has PK for this route.
 * - Miss / route-missing: look it up once and store/merge it.
 */
export async function resolveOrCreateCanonicalDrug(opts: {
  name: string;
  route: string;
  canonicalDrugId?: string | null;
}): Promise<string | null> {
  const name = (opts.name ?? "").trim();
  const route = (opts.route ?? "").trim().toLowerCase();
  if (!name || !route) return opts.canonicalDrugId ?? null;

  const admin = createAdminClient();
  const hasRoute = (row: DrugRow | null) =>
    !!row && Number((row.half_life_hours ?? {})[route]) > 0;

  // 1. Typeahead-matched row.
  if (opts.canonicalDrugId) {
    const { data } = await admin.from("drugs").select(ROW_COLS).eq("id", opts.canonicalDrugId).maybeSingle();
    const row = (data as DrugRow) ?? null;
    if (hasRoute(row)) return row!.id; // pure hit
    if (row) return lookupAndStore(admin, row.canonical_name, route, row); // matched, route missing
  }

  // 2. Name already in the cache (generic-name hit → no LLM).
  const { data: byName } = await admin.from("drugs").select(ROW_COLS).ilike("canonical_name", name).maybeSingle();
  const nameRow = (byName as DrugRow) ?? null;
  if (hasRoute(nameRow)) return nameRow!.id;
  if (nameRow) return lookupAndStore(admin, nameRow.canonical_name, route, nameRow);

  // 3. Miss → look up + insert.
  return lookupAndStore(admin, name, route, null);
}
