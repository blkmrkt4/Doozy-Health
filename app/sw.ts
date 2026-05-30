// @ts-nocheck — This file is compiled by Serwist (webpack), not by the app's
// tsc. The ServiceWorkerGlobalScope types conflict with the app's DOM types.
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Serwist service worker entry (PRD §6.4, §13.17). Provides:
// - Precaching of the app shell (HTML, CSS, JS)
// - Runtime caching for API calls (network-first) and images (cache-first)
// - Push notification handling for dose reminders (PRD §5.5)

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

// ── Push notification handler (PRD §5.5) ───────────────────────────────────

self.addEventListener("push", ((event: PushEvent) => {
  if (!event.data) return;

  try {
    const payload = event.data.json() as {
      title?: string;
      body?: string;
      url?: string;
    };

    const title = payload.title ?? "Doozy Health";
    const options = {
      body: payload.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url ?? "/dashboard" },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    event.waitUntil(
      self.registration.showNotification("Doozy Health", {
        body: "You have a reminder.",
        icon: "/icons/icon-192.png",
      })
    );
  }
}) as EventListener);

// Open the app when a notification is clicked.
self.addEventListener("notificationclick", ((event: NotificationEvent) => {
  event.notification.close();

  const url = (event.notification.data?.url as string) ?? "/dashboard";

  event.waitUntil(
    (self as unknown as { clients: Clients }).clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients: readonly WindowClient[]) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({ type: "navigate", url });
            return;
          }
        }
        return (self as unknown as { clients: Clients }).clients.openWindow(url);
      })
  );
}) as EventListener);

serwist.addEventListeners();
