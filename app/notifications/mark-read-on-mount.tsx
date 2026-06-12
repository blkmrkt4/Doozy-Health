"use client";

import { useEffect, useRef } from "react";
import { markAllNotificationsRead } from "./actions";

// Visiting the notifications page is what "reads" them: fire the per-user
// mark-read action once on mount so the bell dot clears for this user only.
export function MarkReadOnMount({ patientId }: { patientId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void markAllNotificationsRead(patientId);
  }, [patientId]);
  return null;
}
