import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/notifications-server", () => ({ createNotification: vi.fn() }));
import { generateReminders, refreshMedicationReminders, ReminderScheduleError } from "@/lib/reminders";

type Row = Record<string, unknown>;
let data: Record<string, Row[]>;
let failInsert = false;
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let mutation: "insert" | "delete" | "update" | null = null;
  let payload: Row | Row[] = {};
  let single = false;
  const q = {
    select: () => q,
    eq: (key: string, val: unknown) => { filters.push(r => r[key] === val); return q; },
    gte: (key: string, val: string) => { filters.push(r => String(r[key]) >= val); return q; },
    lt: (key: string, val: string) => { filters.push(r => String(r[key]) < val); return q; },
    limit: () => q,
    single: () => { single = true; return q; },
    maybeSingle: () => { single = true; return q; },
    insert: (rows: Row | Row[]) => { mutation = "insert"; payload = rows; return q; },
    update: (row: Row) => { mutation = "update"; payload = row; return q; },
    delete: () => { mutation = "delete"; return q; },
    then: (resolve: (result: { data: Row | Row[] | null; error: object | null }) => unknown) => {
      const rows = data[table] ?? [];
      const matched = rows.filter(r => filters.every(f => f(r)));
      if (mutation === "insert" && failInsert) return Promise.resolve(resolve({ data: null, error: {} }));
      if (mutation === "insert") rows.push(...(Array.isArray(payload) ? payload : [payload]));
      if (mutation === "update") matched.forEach(r => Object.assign(r, payload));
      if (mutation === "delete") data[table] = rows.filter(r => !matched.includes(r));
      return Promise.resolve(resolve({ data: single ? matched[0] ?? null : matched, error: null }));
    },
  };
  return q;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T00:00:00Z")); failInsert = false;
  data = {
    dose_schedules: [{ id: "s", medication_id: "m", patient_id: "p", next_due_at: "2026-09-21T00:00:00Z", generated_through: "2026-09-21T00:00:00Z" }],
    chosen_regimens: [{ medication_id: "m", active: true, created_at: "2026-09-20T00:00:00Z", frequency: { type: "weekly", days: [1, 3, 5], time: "07:00", time_zone: "America/Toronto" } }],
    patient_memberships: [{ patient_id: "p", user_id: "u", role: "owner" }],
    push_subscriptions: [{ id: "push", user_id: "u" }], dose_reminders: [],
  };
  mock.from.mockImplementation(query);
});
afterEach(() => vi.useRealTimers());

describe("reminder schedule reconciliation", () => {
  it("uses named local days and produces no duplicate rows on a second run", async () => {
    expect(await generateReminders("s")).toBe(3);
    expect(data.dose_reminders.map(r => r.due_at)).toEqual(["2026-09-21T11:00:00.000Z", "2026-09-23T11:00:00.000Z", "2026-09-25T11:00:00.000Z"]);
    expect(await generateReminders("s")).toBe(0);
  });
  it("removes unsent old slots but retains delivered history when the plan changes", async () => {
    data.dose_reminders.push({ schedule_id: "s", due_at: "2026-09-22T09:00:00Z", status: "pending" }, { schedule_id: "s", due_at: "2026-09-18T11:00:00Z", status: "acted" });
    await refreshMedicationReminders("m");
    expect(data.dose_reminders).toHaveLength(4);
    expect(data.dose_reminders[0].status).toBe("acted");
    expect(data.dose_reminders.some(r => r.due_at === "2026-09-22T09:00:00Z")).toBe(false);
  });
  it("does not enable notifications just because a plan was saved", async () => {
    data.dose_schedules = []; await refreshMedicationReminders("m");
    expect(data.dose_reminders).toHaveLength(0);
  });
  it("clears pending reminders for an as-needed plan", async () => {
    data.chosen_regimens[0].frequency = { type: "as_needed" };
    data.dose_reminders.push({ schedule_id: "s", due_at: "2026-09-22T09:00:00Z", status: "pending" });
    await refreshMedicationReminders("m"); expect(data.dose_reminders).toHaveLength(0);
  });
  it("can retry a failed generation without skipping the upcoming week", async () => {
    failInsert = true;
    await expect(refreshMedicationReminders("m")).rejects.toBeInstanceOf(ReminderScheduleError);
    failInsert = false; await refreshMedicationReminders("m", false);
    expect(data.dose_reminders).toHaveLength(3);
  });
  it("keeps an existing interval phase when an edit did not change the plan", async () => {
    data.chosen_regimens[0].frequency = { type: "every", interval: 1, unit: "day" };
    data.dose_schedules[0].next_due_at = "2026-09-21T16:00:00Z";
    await refreshMedicationReminders("m", false);
    expect(data.dose_reminders[0].due_at).toBe("2026-09-21T16:00:00.000Z");
  });
});

it("retains the phase of long legacy intervals outside the generated window", async () => {
  data.chosen_regimens[0].frequency = { type: "every", interval: 24, unit: "month" };
  const anchor = Date.parse(String(data.dose_schedules[0].next_due_at));
  await generateReminders("s");
  expect(new Date(String(data.dose_schedules[0].next_due_at)).getTime()).toBe(anchor + 720 * 86_400_000);
});
