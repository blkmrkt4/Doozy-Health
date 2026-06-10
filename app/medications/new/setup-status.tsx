import { COMPLIANCE_COLOURS } from "@/lib/colours";

// The at-a-glance setup status shared by the add page's top checklist and the
// form rows below it. Design intent (a fast, low-reading glance for an elderly
// user or caregiver): a traffic-light mark answers "did I do the thing?" — red
// only when the app genuinely won't work without it, yellow when it works but
// more detail would help, green when done. Actionable items wear an attention
// colour and a short "why"; done items go quiet.

export type RowStatus = "done" | "todo" | "optional" | "na";

export type CheckItem = {
  key: string;
  href: string;
  label: string;
  /** one short line of context, shown only while the item is unfinished */
  context: string;
  status: RowStatus;
};

export type SetupStatus = { items: CheckItem[]; ready: boolean };

// A deliberate, warm attention colour for "you still need to do this" — high
// contrast against the monochrome fields so it's spotted without reading. Kept
// as a single named constant rather than scattered hex.
export const ATTENTION_ORANGE = "#FF7A1A";

type Glyph = { glyph: string; bg: string; fg: string };
// Saturated status colours come from the sanctioned adherence palette
// (lib/colours) — green = done, yellow = works-but-could-be-better, red = the
// one required thing is missing.
const MARK: Record<Exclude<RowStatus, "na">, Glyph> = {
  done: { glyph: "✓", bg: COMPLIANCE_COLOURS.full, fg: "#06210F" },
  optional: { glyph: "!", bg: COMPLIANCE_COLOURS.partial, fg: "#3A2D00" },
  todo: { glyph: "✕", bg: COMPLIANCE_COLOURS.missed, fg: "#FFFFFF" },
};

/** A solid traffic-light dot: green ✓ done, yellow ! partial, red ✕ required &
 *  missing. Renders nothing for "na" (the item doesn't apply to this product). */
export function StatusMark({
  status,
  size = 20,
}: {
  status: RowStatus;
  size?: number;
}) {
  if (status === "na") return null;
  const m = MARK[status];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none"
      style={{
        width: size,
        height: size,
        backgroundColor: m.bg,
        color: m.fg,
        fontSize: Math.round(size * 0.58),
      }}
    >
      {m.glyph}
    </span>
  );
}

/** The top-of-page checklist: what this product needs, scannable in a glance.
 *  No card — a plain left-aligned list so it reads as a checklist, not another
 *  field box. Unfinished items wear the attention colour + a short why; done
 *  items go muted. */
export function SetupList({ status }: { status: SetupStatus }) {
  return (
    <div className="mt-6">
      <ul className="space-y-3">
        {status.items.map((it) => {
          const done = it.status === "done";
          return (
            <li key={it.key}>
              <a href={it.href} className="flex items-start gap-3">
                <StatusMark status={it.status} />
                <span className="min-w-0">
                  <span
                    className="text-sm font-semibold"
                    style={{
                      color: done ? "var(--color-muted)" : ATTENTION_ORANGE,
                    }}
                  >
                    {it.label}
                  </span>
                  {!done && it.context ? (
                    <span className="mt-0.5 block text-xs text-faint">
                      {it.context}
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {status.ready ? (
        <p
          className="mt-3 text-xs font-medium"
          style={{ color: COMPLIANCE_COLOURS.full }}
        >
          Ready — save below to start logging.
        </p>
      ) : null}
    </div>
  );
}
