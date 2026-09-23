import { isFrequency, type WeeklyFrequency } from "@/lib/types";

const DAY = 86_400_000;

/** Local calendar fields, independent of the server/browser time zone. */
function localParts(ms: number, formatter: Intl.DateTimeFormat): number[] {
  const parts = formatter.formatToParts(ms);
  return ["year", "month", "day", "hour", "minute"].map(
    (key) => Number(parts.find((p) => p.type === key)?.value)
  );
}

function wallMs(parts: number[]): number {
  return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
}

/** DST: repeated times occur once (earlier offset); skipped times move forward
 * by the clock change. Sampling both sides also handles half-hour transitions. */
function toInstant(local: number, formatter: Intl.DateTimeFormat): number {
  const offsets = new Set([-2, -1, 0, 1, 2].map((d) => {
    const sample = local + d * DAY;
    return wallMs(localParts(sample, formatter)) - sample;
  }));
  const candidates = [...offsets].map((offset) => local - offset);
  const exact = candidates.filter((ms) => wallMs(localParts(ms, formatter)) === local);
  if (exact.length) return Math.min(...exact);
  const later = candidates.filter((ms) => wallMs(localParts(ms, formatter)) > local);
  return Math.min(...later);
}

/** Named-day occurrences in [start, end). One occurrence per selected local
 * date, including across daylight-saving changes (PRD §5.5). */
export function weeklyOccurrences(freq: WeeklyFrequency, start: number, end: number): number[] {
  if (!isFrequency(freq) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: freq.time_zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const first = localParts(start, formatter);
  const last = localParts(end, formatter);
  // Untimed plans use a date boundary only for calendar counting, never reminders.
  const [hour, minute] = (freq.time ?? "00:00").split(":").map(Number);
  const lastDay = Date.UTC(last[0], last[1] - 1, last[2]);
  const result: number[] = [];
  let day = Date.UTC(first[0], first[1] - 1, first[2]);
  for (let visited = 0; day <= lastDay && visited < 35_000 && result.length < 5000; visited++, day += DAY) {
    const weekday = new Date(day).getUTCDay() || 7;
    if (!freq.days.includes(weekday)) continue;
    const instant = toInstant(day + hour * 3_600_000 + minute * 60_000, formatter);
    if (instant >= start && instant < end) result.push(instant);
  }
  return [...new Set(result)].sort((a, b) => a - b);
}

/** A log belongs to the date in its saved schedule's zone, not the host's. */
export function zonedDayKey(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  return ["year", "month", "day"].map((key) => parts.find((p) => p.type === key)!.value).join("-");
}
