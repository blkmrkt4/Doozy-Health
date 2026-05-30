import "server-only";
import { readSecret } from "@/lib/secrets";

// Twilio SMS sender via raw REST API (PRD §5.5). Uses fetch instead of the
// Twilio SDK (~150kB) to keep the bundle lean. Credentials stored in
// system_secrets: twilio_account_sid, twilio_auth_token, twilio_from_number.

/**
 * Send an SMS via the Twilio REST API. Returns the message SID on success,
 * or null on failure.
 */
export async function sendSms(
  to: string,
  body: string
): Promise<string | null> {
  const accountSid = await readSecret("twilio_account_sid");
  const authToken = await readSecret("twilio_auth_token");
  const fromNumber = await readSecret("twilio_from_number");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    console.error(`Twilio SMS failed (${res.status}): ${text}`);
    return null;
  }

  const json = (await res.json()) as { sid?: string };
  return json.sid ?? null;
}
