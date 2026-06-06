"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAndExtractSyringe } from "@/app/inventory/actions";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !formRef.current) {
      setFileName(null);
      return;
    }
    setFileName(file.name);
    setError(null);
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      try {
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
        <form ref={formRef} action={uploadAndExtractSyringe}>
          <label className="block cursor-pointer rounded-md border border-dashed border-line bg-surface px-3 py-2.5 text-center text-sm transition-colors hover:border-muted">
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/heic,image/heif"
              onClick={() => {
                setError(null);
                router.replace("/inventory/new");
              }}
              onChange={handleFileChange}
              className="hidden"
            />
            {fileName ? (
              <span className="text-paper">{fileName}</span>
            ) : (
              <span className="text-faint">Tap to choose a photo — extracts automatically</span>
            )}
          </label>
          {error ? (
            <p className="mt-3 rounded-md border alert-error p-3 text-sm">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
