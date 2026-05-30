import "server-only";
import webPush from "web-push";
import { readSecret } from "@/lib/secrets";

// Web Push notification sender (PRD §5.5). Uses the web-push library with
// VAPID keys stored in system_secrets. Dependency: web-push (~15kB) —
// required for VAPID signing + push endpoint delivery. Alternative: raw
// HTTP to push services (complex, error-prone, no VAPID helper).

let vapidInitialised = false;

async function ensureVapid(): Promise<void> {
  if (vapidInitialised) return;

  const publicKey = await readSecret("vapid_public_key");
  const privateKey = await readSecret("vapid_private_key");

  webPush.setVapidDetails(
    "mailto:support@doozy.health",
    publicKey,
    privateKey
  );

  vapidInitialised = true;
}

export type PushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Send a push notification to a registered subscription. Returns true on
 * success, false on failure (expired/invalid subscription).
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string }
): Promise<boolean> {
  await ensureVapid();

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 3600 } // 1 hour
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410 = subscription expired or unsubscribed.
    if (status === 404 || status === 410) {
      return false;
    }
    throw err;
  }
}
