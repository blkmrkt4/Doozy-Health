import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { relativeAge } from "@/lib/format";
import {
  renderNotification,
  type NotificationSeverity,
  type NotificationType,
} from "@/lib/notifications";
import { MarkReadOnMount } from "./mark-read-on-mount";

// Notifications (PRD §4.6/§5.5 surface). A calm, dense, factual list — copy is
// rendered from the stored payload by the single §6.1-reviewed surface in
// lib/notifications.ts. RLS scopes the list to the caller's membership and
// hides private-medication rows from non-owners. Visiting the page marks the
// caller's rows read (per user — a caregiver's dot is their own).

type NotificationRow = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  medication_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

function severityGlyph(severity: NotificationSeverity) {
  // serious = the danger token (factual emphasis, not alarm); others stay muted.
  const tone =
    severity === "serious" ? "text-[var(--color-danger-text)]" : "text-muted";
  return (
    <span
      aria-hidden
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`}
      style={{ backgroundColor: "currentcolor" }}
    />
  );
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, type, severity, medication_id, payload, created_at")
    .eq("patient_id", active.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const notifications = (rows ?? []) as NotificationRow[];

  const { data: readRows } = await supabase
    .from("notification_reads")
    .select("notification_id")
    .in(
      "notification_id",
      notifications.map((n) => n.id)
    );
  const readIds = new Set((readRows ?? []).map((r) => r.notification_id as string));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <MarkReadOnMount patientId={active.id} />
      <h1 className="text-xl font-medium tracking-tight">Notifications</h1>

      {notifications.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm text-muted">No notifications yet.</p>
          <p className="mt-1 text-xs text-faint">
            Supply estimates and snapshot notes will show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-md border border-line">
          {notifications.map((n) => {
            const rendered = renderNotification(n.type, n.payload ?? {});
            const unread = !readIds.has(n.id);
            const href =
              n.medication_id != null ? `/medications/${n.medication_id}` : "/report";
            return (
              <li
                key={n.id}
                className={`px-4 py-3 ${unread ? "border-l-2 border-l-accent" : ""}`}
              >
                <div className="flex items-start gap-3">
                  {severityGlyph(n.severity)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={href}
                        className="min-w-0 truncate text-sm font-medium text-paper blur-private hover:underline"
                      >
                        {rendered.title}
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-faint">
                        {relativeAge(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted blur-private">{rendered.body}</p>
                    {rendered.detail ? (
                      <p className="mt-1 text-xs text-faint blur-private">{rendered.detail}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
