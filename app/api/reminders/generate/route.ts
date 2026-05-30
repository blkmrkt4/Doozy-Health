import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReminders } from "@/lib/reminders";

// Cron endpoint: regenerate dose reminders for all active schedules.
// Protected by a cron secret in the Authorization header (stored in
// system_secrets as 'cron_secret'). Called by an external cron service.

export async function POST(req: NextRequest) {
  // Validate the cron secret.
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Load all active schedules.
  const { data: schedules } = await admin
    .from("dose_schedules")
    .select("id");

  if (!schedules || schedules.length === 0) {
    return NextResponse.json({ generated: 0, schedules: 0 });
  }

  let totalGenerated = 0;
  for (const s of schedules) {
    const count = await generateReminders(s.id as string);
    totalGenerated += count;
  }

  return NextResponse.json({
    generated: totalGenerated,
    schedules: schedules.length,
  });
}
