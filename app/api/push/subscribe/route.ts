import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSecret } from "@/lib/secrets";

// Web Push subscription endpoint (PRD §5.5). Registers a push subscription
// for the authenticated user. The service worker sends the subscription
// object here after obtaining permission.

/**
 * The VAPID public key, for the browser's pushManager.subscribe call. The
 * public half is not a secret, but require auth anyway — only signed-in users
 * have any business subscribing.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const key = await readSecret("vapid_public_key");
    return NextResponse.json({ key });
  } catch {
    return NextResponse.json(
      { error: "Push is not configured on this deployment." },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = (await req.json()) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "Missing subscription fields" },
      { status: 400 }
    );
  }

  // Upsert on endpoint (a device re-subscribing gets the same row).
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
