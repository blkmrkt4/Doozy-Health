"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAndExtractSyringe } from "@/app/inventory/actions";
import { toUploadJpeg } from "@/lib/image-client";

// Scan a syringe packaging photo — choosing a photo uploads + extracts in one
// tap (mirrors the medication ScanForm). American English.

function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function SyringeScanForm() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFile(file?: File) {
    if (!file) return;
    setError(null);
    router.replace("/inventory/new"); // clear a stale ?error=
    startTransition(async () => {
      try {
        const fd = new FormData();
        // Re-encode to a downscaled JPEG (HEIC → JPEG) for the vision model.
        fd.set("photo", await toUploadJpeg(file));
        await uploadAndExtractSyringe(fd);
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError("Something went wrong starting the scan. Try again, or enter the details manually.");
      }
    });
  }

  return (
    <section className="rounded-md border border-line p-4 space-y-3">
      <h2 className="text-sm font-medium text-paper">Scan the packaging</h2>
      <p className="text-xs text-faint">
        Take a photo of the syringe box or wrapper and we will read off the
        capacity, gauge, and needle length for you to review.
      </p>

      {isPending ? (
        <p className="py-6 text-center text-sm text-faint">Reading the photo…</p>
      ) : (
        <div className="space-y-3">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper transition-colors hover:border-muted"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              Take photo
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper transition-colors hover:border-muted"
            >
              Choose photo
            </button>
          </div>
          {error ? (
            <p className="rounded-md border alert-error p-3 text-sm">{error}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
