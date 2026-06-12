import type { RunOut } from "@/lib/supply";
import type { InteractionFact } from "@/lib/interactions";

// In-app notifications — PURE core (PRD §4.6/§5.5 surface). Types, dedupe
// keys, copy rendering, and the decide* functions live here with no server
// imports (type-only above), so the §6.1 copy tests and dedupe tests run
// everywhere without a stack. The event-hook evaluators and persistence are in
// lib/notifications-server.ts (same pure-compute/thin-loader split as
// lib/report/report-data.ts).
//
// Rows are created from DETERMINISTIC facts only — supply projections
// (lib/supply.ts), curated interactions (rule #9), and doses-above-regimen
// from the report facts — never by an LLM. "Don't overwhelm" is structural:
// every notification carries a dedupe_key, the table is unique on
// (patient_id, dedupe_key), and the cooldown is encoded in the key's bucket
// (one per fill, one per drug pair, one per recount, …).
//
// All user-facing copy lives in renderNotification — the single reviewable
// surface for the §6.1 line: factual, never directive. No "refill now", no
// "do not take", no dose instruction. Interactions inform and point at the
// clinician.

export type NotificationType =
  | "supply_low_medication"
  | "supply_low_item"
  | "interaction"
  | "dose_above_prescribed";

export type NotificationSeverity = "info" | "caution" | "serious";

/** The row shape handed to the service-role insert (snake_case = DB columns). */
export type NotificationInsert = {
  patient_id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  medication_id: string | null;
  inventory_item_id: string | null;
  report_summary_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

/** Days-of-supply threshold under which a low-supply notification is created. */
export const LOW_SUPPLY_DAYS = 7;

/** Trailing window used to estimate syringe usage rate from logged doses. */
export const ITEM_USAGE_WINDOW_DAYS = 14;

const INJECTABLE_ROUTES = new Set(["intramuscular", "subcutaneous"]);

export function isInjectableRoute(route: string | null | undefined): boolean {
  return route != null && INJECTABLE_ROUTES.has(route);
}

// ── Dedupe keys ───────────────────────────────────────────────────────────────
// The cooldown lives in the key's bucket, not a timestamp comparison: while the
// bucket is unchanged the unique constraint swallows re-evaluations.

/** One notification per fill: a refill is a new delivery_forms row. */
export function medSupplyDedupeKey(medicationId: string, deliveryFormId: string): string {
  return `supply_low:med:${medicationId}:${deliveryFormId}`;
}

/** One notification per owner-entered count: a recount opens a new bucket. */
export function itemSupplyDedupeKey(itemId: string, quantitySetAt: string | null): string {
  const bucket = quantitySetAt ? new Date(quantitySetAt).getTime() : "na";
  return `supply_low:item:${itemId}:${bucket}`;
}

/** Once per drug pair per patient, ever (ids sorted so order can't differ). */
export function interactionDedupeKey(drugAId: string, drugBId: string): string {
  const [a, b] = [drugAId, drugBId].sort();
  return `interaction:${a}:${b}`;
}

/** Keyed by the date of the latest over-amount example, so regenerating the
 *  same snapshot (or an overlapping window) is a no-op. */
export function overPrescribedDedupeKey(medicationId: string, latestDate: string): string {
  return `over_prescribed:med:${medicationId}:${latestDate}`;
}

// ── Copy (the single §6.1 surface) ───────────────────────────────────────────

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jun 19", with the year only when it differs from now's. */
function monthDay(iso: string, now: number): string {
  // Date-only strings parse as local midnight so the day label can't shift.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? "" : `, ${d.getFullYear()}`}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type RenderedNotification = {
  title: string;
  body: string;
  /** Optional second line (e.g. the curated interaction mechanism, verbatim). */
  detail?: string;
};

/**
 * Render a notification's user-facing strings from its structured payload.
 * Factual and neutral throughout (§6.1): estimates are labelled as estimates,
 * interactions inform ("discuss with your doctor or pharmacist") and never
 * direct, and the over-amount note is a record, not a warning. Defensive about
 * payload shape — rows outlive code revisions.
 */
export function renderNotification(
  type: NotificationType,
  payload: Record<string, unknown>,
  now: number = Date.now()
): RenderedNotification {
  const s = (k: string, fallback = "—") => {
    const v = payload[k];
    return typeof v === "string" && v.trim() ? v : fallback;
  };
  const n = (k: string): number | null => {
    const v = Number(payload[k]);
    return Number.isFinite(v) ? v : null;
  };

  switch (type) {
    case "supply_low_medication": {
      const medName = s("medName", "a medication");
      const remaining = n("remaining");
      const unit = s("packageUnit", "units");
      const runOutAt = typeof payload.runOutAtISO === "string" ? payload.runOutAtISO : null;
      const title = `Supply estimate — ${medName}`;
      if (remaining != null && remaining <= 0) {
        return {
          title,
          body: `Based on what you've logged, the current fill of ${medName} is used up.`,
        };
      }
      const qty = remaining != null ? `about ${round1(remaining)} ${unit} left` : "a low amount left";
      if (runOutAt) {
        return {
          title,
          body:
            `At the logged rate, ${medName} is projected to run out around ` +
            `${monthDay(runOutAt, now)} (${qty}). This is an estimate based on what you've logged.`,
        };
      }
      return { title, body: `${medName} has ${qty}, based on what you've logged.` };
    }

    case "supply_low_item": {
      const label = s("label", "a supply item");
      const quantity = n("quantity");
      const runOutAt = typeof payload.runOutAtISO === "string" ? payload.runOutAtISO : null;
      const title = `Supply estimate — ${label}`;
      if (quantity != null && quantity <= 0) {
        return {
          title,
          body: `Based on what you've logged, your ${label} supply is used up.`,
        };
      }
      const qty = quantity != null ? ` (${round1(quantity)} left)` : "";
      const around = runOutAt ? ` around ${monthDay(runOutAt, now)}` : " soon";
      return {
        title,
        body: `At the recent usage rate, your ${label} supply is projected to run out${around}${qty}.`,
      };
    }

    case "interaction": {
      const aName = s("aName", "one of your medications");
      const bName = s("bName", "another entry in your records");
      const mechanism = typeof payload.mechanism === "string" ? payload.mechanism.trim() : "";
      return {
        title: "Known interaction recorded",
        body:
          `Your records include both ${aName} and ${bName}. ` +
          `These are known to interact — discuss with your doctor or pharmacist.`,
        ...(mechanism ? { detail: mechanism } : {}),
      };
    }

    case "dose_above_prescribed": {
      const medName = s("medName", "a medication");
      const date = s("date", "");
      const logged = s("loggedLabel");
      const onRecord = s("prescribedLabel");
      const when = date ? `On ${monthDay(date, now)}, ` : "";
      return {
        title: `Logged amount above the regimen on record — ${medName}`,
        body:
          `${when}a logged dose of ${medName} was ${logged}; the amount on ` +
          `record is ${onRecord} — discuss with your doctor or pharmacist.`,
      };
    }
  }
}

// ── Deciders (pure; the server evaluators feed them, the tests exercise them) ─

export function decideMedSupplyNotification(opts: {
  patientId: string;
  medicationId: string;
  deliveryFormId: string;
  medName: string;
  runOut: RunOut | null;
}): NotificationInsert | null {
  const r = opts.runOut;
  if (!r || r.daysLeft == null || r.daysLeft > LOW_SUPPLY_DAYS) return null;
  // A projection needs a steady rate; ranOut (remaining 0) stands on its own.
  if (!r.ranOut && !(r.unitsPerDay != null && r.unitsPerDay > 0)) return null;
  return {
    patient_id: opts.patientId,
    type: "supply_low_medication",
    severity: "info",
    medication_id: opts.medicationId,
    inventory_item_id: null,
    report_summary_id: null,
    payload: {
      medName: opts.medName,
      remaining: r.remaining,
      packageUnit: r.packageUnit,
      runOutAtISO: r.runOutAt ? r.runOutAt.toISOString() : null,
    },
    dedupe_key: medSupplyDedupeKey(opts.medicationId, opts.deliveryFormId),
  };
}

export function decideItemSupplyNotification(opts: {
  patientId: string;
  itemId: string;
  label: string;
  quantity: number;
  quantitySetAt: string | null;
  /** injectable taken/prn logs in the trailing window, across all medications
   *  that use this item (one syringe per injection). */
  usageCount: number;
  windowDays?: number;
  now: number;
}): NotificationInsert | null {
  const windowDays = opts.windowDays ?? ITEM_USAGE_WINDOW_DAYS;
  const ratePerDay = windowDays > 0 ? opts.usageCount / windowDays : 0;
  if (!(ratePerDay > 0)) return null;
  const daysLeft = opts.quantity / ratePerDay;
  if (daysLeft > LOW_SUPPLY_DAYS) return null;
  return {
    patient_id: opts.patientId,
    type: "supply_low_item",
    severity: "info",
    medication_id: null,
    inventory_item_id: opts.itemId,
    report_summary_id: null,
    payload: {
      label: opts.label,
      quantity: opts.quantity,
      runOutAtISO: new Date(opts.now + daysLeft * 86_400_000).toISOString(),
    },
    dedupe_key: itemSupplyDedupeKey(opts.itemId, opts.quantitySetAt),
  };
}

/** "Strong reason only" rule for snapshot interactions: serious always;
 *  caution only when one side is a diary-logged substance (its presence in the
 *  facts already implies it was logged in the report window); info never. */
export function shouldNotifyInteraction(fact: InteractionFact): boolean {
  if (fact.severity === "serious") return true;
  if (fact.severity === "caution") return fact.aIsSubstance || fact.bIsSubstance;
  return false;
}

export function decideSnapshotNotifications(opts: {
  patientId: string;
  reportSummaryId: string | null;
  interactions: InteractionFact[];
  /** canonical drug id → owning medication, for source links + privacy routing. */
  medsByDrugId: Map<string, { id: string; isPrivate: boolean }>;
  /** medication id → { name, latest over-amount example }. */
  overDose: {
    medicationId: string;
    medName: string;
    date: string;
    loggedLabel: string;
    prescribedLabel: string;
  }[];
}): NotificationInsert[] {
  const inserts: NotificationInsert[] = [];

  for (const fact of opts.interactions) {
    if (!shouldNotifyInteraction(fact)) continue;
    // Privacy routing: if either side is a private medication, carry THAT
    // medication_id so can_read_medication hides the row from non-owners.
    const a = opts.medsByDrugId.get(fact.aDrugId) ?? null;
    const b = opts.medsByDrugId.get(fact.bDrugId) ?? null;
    const med = a?.isPrivate ? a : b?.isPrivate ? b : a ?? b;
    inserts.push({
      patient_id: opts.patientId,
      type: "interaction",
      severity: fact.severity,
      medication_id: med?.id ?? null,
      inventory_item_id: null,
      report_summary_id: opts.reportSummaryId,
      payload: {
        aName: fact.aLabel,
        bName: fact.bLabel,
        mechanism: fact.mechanism,
      },
      dedupe_key: interactionDedupeKey(fact.aDrugId, fact.bDrugId),
    });
  }

  for (const od of opts.overDose) {
    inserts.push({
      patient_id: opts.patientId,
      type: "dose_above_prescribed",
      severity: "info", // a factual record, deliberately not a warning (§6.1)
      medication_id: od.medicationId,
      inventory_item_id: null,
      report_summary_id: opts.reportSummaryId,
      payload: {
        medName: od.medName,
        date: od.date,
        loggedLabel: od.loggedLabel,
        prescribedLabel: od.prescribedLabel,
      },
      dedupe_key: overPrescribedDedupeKey(od.medicationId, od.date),
    });
  }

  return inserts;
}
