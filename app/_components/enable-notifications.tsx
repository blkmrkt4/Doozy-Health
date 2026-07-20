"use client";

import { useEffect, useState } from "react";

// Device push opt-in (PRD §5.5). The reminders engine and caregiver
// escalations can only reach a device that has registered a push
// subscription; this is the one place that wiring happens: service worker →
// Notification permission → pushManager.subscribe → POST /api/push/subscribe.
// Factual copy throughout — enabling notifications is a device setting, not
// an instruction to dose (PRD §6.1).

type Status =
  | "checking"
  | "unsupported"
  | "unconfigured"
  | "off"
  | "denied"
  | "on"
  | "working"
  | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function EnableNotifications() {
  const [status, setStatus] = useState<Status>("checking");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("error"));
  }, []);

  async function enable() {
    setStatus("working");
    setDetail(null);
    try {
      // The VAPID public key — 503 when push isn't configured server-side.
      const keyRes = await fetch("/api/push/subscribe");
      if (!keyRes.ok) {
        setStatus(keyRes.status === 503 ? "unconfigured" : "error");
        return;
      }
      const { key } = (await keyRes.json()) as { key: string };

      // Serwist registers the worker in production builds; register directly
      // as a fallback (also covers a first visit before Serwist's hook runs).
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js");
      }
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      if (!res.ok) {
        setStatus("error");
        setDetail("The subscription could not be saved. Please try again.");
        return;
      }
      setStatus("on");
    } catch {
      setStatus("error");
      setDetail(
        "Could not turn on notifications on this device. If the app was just installed, try once more."
      );
    }
  }

  if (status === "checking") return null;

  if (status === "unsupported") {
    return (
      <p className="text-sm text-faint">
        This browser doesn&rsquo;t support push notifications. On iPhone, add
        WellKept to the Home Screen first, then enable notifications from the
        installed app.
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p className="text-sm text-faint">
        Notifications are blocked for WellKept in this browser&rsquo;s settings.
        Allow them there, then return here.
      </p>
    );
  }

  if (status === "unconfigured") {
    return (
      <p className="text-sm text-faint">
        Push notifications aren&rsquo;t configured on this deployment yet.
      </p>
    );
  }

  if (status === "on") {
    return (
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Notifications are on for this device.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={enable}
        disabled={status === "working"}
        className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {status === "working" ? "Turning on…" : "Turn on notifications on this device"}
      </button>
      {status === "error" && detail ? (
        <p className="text-xs text-faint">{detail}</p>
      ) : null}
    </div>
  );
}
