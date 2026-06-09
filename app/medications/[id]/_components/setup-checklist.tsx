import Link from "next/link";
import {
  setMedicationSyringe,
  toggleAccessoryAcknowledged,
} from "@/app/medications/actions";
import { COMPLIANCE_COLOURS } from "@/lib/colours";
import type { SetupItem } from "@/lib/medication-setup";

// Medication setup checklist (PRD §5.1–5.3). Shows what this medication
// references and what's still missing, satisfied by a photo OR by hand. Soft —
// nothing here blocks logging. Server component: every control is a plain
// <form action={…}> like the rest of the detail page. Factual copy (§6.1).

const GREEN = COMPLIANCE_COLOURS.full; // the project's "done" green (as on the calendar)

export function SetupChecklist({
  medicationId,
  items,
  syringes,
  currentSyringeId,
  isOwner,
}: {
  medicationId: string;
  items: SetupItem[];
  syringes: { id: string; label: string }[];
  currentSyringeId: string | null;
  isOwner: boolean;
}) {
  const tracked = items.filter((i) => i.tier !== "awareness");
  const done = tracked.filter((i) => i.satisfied).length;
  const allDone = done === tracked.length;

  // A collapsed twisty on the detail page — tucked, not at the top (the live
  // checklist for adding lives on the Add screen).
  return (
    <details className="rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-paper">
        <span>Setup</span>
        <span className="text-xs text-faint">
          {allDone ? "All set" : `${done} of ${tracked.length} to add`}
        </span>
      </summary>
      <div className="space-y-3 border-t border-line p-4">
        <p className="text-xs text-faint">
          What this medication references — add each by photo or by hand. Nothing
          here blocks logging.
        </p>

        <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className={item.satisfied ? "mt-0.5" : "mt-0.5 text-faint"}
              style={item.satisfied ? { color: GREEN } : undefined}
            >
              {item.satisfied ? "✓" : "○"}
            </span>
            <div className="min-w-0 flex-1">
              <p className={item.satisfied ? "text-muted" : "text-paper"}>
                {item.label}
                {item.tier === "awareness" ? (
                  <span className="ml-1.5 text-xs text-faint">(optional)</span>
                ) : null}
              </p>

              {!item.satisfied ? (
                <p className="mt-0.5 text-xs text-faint">{item.actionHint}</p>
              ) : null}

              {/* Syringe: the one in-place control (others link out). */}
              {isOwner && item.key === "syringe" ? (
                <form
                  action={setMedicationSyringe}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="medication_id" value={medicationId} />
                  <select
                    name="syringe_id"
                    defaultValue={currentSyringeId ?? ""}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-paper outline-none focus:border-accent"
                  >
                    <option value="">— none —</option>
                    {syringes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface"
                  >
                    Set
                  </button>
                  <Link href="/inventory/new" className="text-xs text-accent hover:underline">
                    Add a syringe
                  </Link>
                </form>
              ) : null}

              {/* Awareness accessory: a one-tap "I have it" acknowledgment. */}
              {isOwner && item.tier === "awareness" ? (
                <form action={toggleAccessoryAcknowledged} className="mt-1.5">
                  <input type="hidden" name="medication_id" value={medicationId} />
                  <input
                    type="hidden"
                    name="accessory_type"
                    value={item.key.replace(/^accessory:/, "")}
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface"
                  >
                    {item.satisfied ? "Got it — undo" : "I have this"}
                  </button>
                </form>
              ) : null}

              {/* Label / prescription / diluent: provide manually (edit) or by a
                  photo (the attach form lives further down the page). */}
              {isOwner &&
              !item.satisfied &&
              (item.key === "label" ||
                item.key === "prescription" ||
                item.key === "diluent") ? (
                <p className="mt-1 text-xs">
                  <Link
                    href={`/medications/${medicationId}/edit`}
                    className="text-accent hover:underline"
                  >
                    Enter manually
                  </Link>
                  <span className="text-faint"> · or add a photo below</span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
        </ul>
      </div>
    </details>
  );
}
