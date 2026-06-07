"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAndExtract } from "@/app/medications/actions";

// Scan form: choosing a photo immediately uploads and extracts — one tap, no
// separate button. An animated beaker fills while the LLM processes.

/** A redirect thrown by a server action carries a NEXT_REDIRECT digest; it must
 *  be re-thrown so the framework can navigate, not swallowed as a failure. */
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function ScanForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePickerOpen() {
    // Starting a new scan should clear any leftover message from the previous
    // attempt: the inline one (client state) and the top-of-page one (the
    // server-rendered ?error= param), so a stale notice doesn't linger.
    setError(null);
    router.replace("/medications/new");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !formRef.current) {
      setFileName(null);
      return;
    }
    setFileName(file.name);
    setError(null);

    // Snapshot the form data now (the form unmounts once the beaker shows),
    // then await the action so the pending state — and the beaker — stay up
    // for the whole upload + extraction, and its redirect actually applies.
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      try {
        await uploadAndExtract(fd);
      } catch (err) {
        // A successful or handled run ends in a redirect (the framework
        // navigates — not caught here). This only fires for an unexpected
        // throw, which would otherwise leave the beaker vanishing in silence.
        if (isRedirectError(err)) throw err;
        setError(
          "Something went wrong starting the scan. Please try again, or enter the details manually below."
        );
      }
    });
  }

  return (
    <section className="mt-6 rounded-md border border-line p-4 space-y-3">
      <h2 className="text-sm font-medium text-paper">Scan a photo</h2>
      <p className="text-xs text-faint">
        Take a photo of a vial, package, or prescription — we&rsquo;ll detect
        which it is and extract the details for you to review.
      </p>

      {isPending ? (
        <ExtractingIndicator />
      ) : (
        <form ref={formRef} action={uploadAndExtract} className="space-y-3">
          {/* No type picker: the extractor reads the photo, defaults to a vial,
              and transparently switches to the prescription reader (and back)
              when the photo is actually the other kind (see uploadAndExtract). */}

          {/* File input styled via the label — choosing a photo starts
              extraction immediately, so this is the only control needed. */}
          <label className="block cursor-pointer rounded-md border border-dashed border-line bg-surface px-3 py-2.5 text-center text-sm transition-colors hover:border-muted">
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/heic,image/heif"
              onClick={handlePickerOpen}
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
            <p className="rounded-md border alert-error p-3 text-sm">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}

/** Animated beaker filling indicator while the LLM works. */
function ExtractingIndicator() {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative">
        <svg width="64" height="80" viewBox="0 0 64 80" className="overflow-visible">
          <path
            d="M 18 10 L 18 30 L 8 65 Q 6 72 12 75 L 52 75 Q 58 72 56 65 L 46 30 L 46 10"
            fill="none"
            stroke="var(--color-faint)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="14" y1="10" x2="50" y2="10" stroke="var(--color-faint)" strokeWidth="2" strokeLinecap="round" />
          <clipPath id="beaker-clip">
            <path d="M 18 30 L 8 65 Q 6 72 12 75 L 52 75 Q 58 72 56 65 L 46 30 Z" />
          </clipPath>
          <rect x="6" y="75" width="52" height="50" fill="#F4EE35" opacity="0.3" clipPath="url(#beaker-clip)">
            <animate attributeName="y" from="75" to="28" dur="3s" repeatCount="indefinite" />
          </rect>
          <circle cx="28" cy="60" r="2" fill="#F4EE35" opacity="0.5">
            <animate attributeName="cy" from="65" to="35" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.6" to="0" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="36" cy="55" r="1.5" fill="#F4EE35" opacity="0.4">
            <animate attributeName="cy" from="60" to="30" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.5" to="0" dur="2.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="32" cy="50" r="1" fill="#F4EE35" opacity="0.3">
            <animate attributeName="cy" from="55" to="25" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-paper">Extracting...</p>
        <p className="mt-1 text-xs text-faint">
          Reading the photo and pulling out the details
        </p>
      </div>
    </div>
  );
}
