import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendReminder } from "@/lib/reminders";

// Cron endpoint: send all pending reminders whose due_at has passed.
// Protected by a cron secret. Called by an external cron service.

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Load pending reminders that are due.
  const { data: pending } = await admin
    .from("dose_reminders")
    .select("id")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at")
    .limit(100);

  if (!pending || pending.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const r of pending) {
    const ok = await sendReminder(r.id as string);
    if (ok) sent++;
    else failed++;
  }

  return NextResponse.json({ sent, failed });
}
