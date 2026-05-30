"use client";

import { useTransition } from "react";
import { viewExtractionSource } from "../actions";

// Client component for the audit-logged "view source" action (PRD §14.7).
// Opens the signed URL in a new tab after the server action logs the view.

export function ViewSourceButton({
  deltaId,
  documentId,
}: {
  deltaId: string;
  documentId: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("delta_id", deltaId);
      fd.set("document_id", documentId);
      const url = await viewExtractionSource(fd);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="text-[10px] text-accent hover:underline disabled:opacity-50"
    >
      {isPending ? "Loading..." : "view source"}
    </button>
  );
}
