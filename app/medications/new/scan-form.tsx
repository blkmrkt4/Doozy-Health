"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAndExtract } from "@/app/medications/actions";
import { toUploadJpeg } from "@/lib/image-client";

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

const MAX_PHOTOS = 5;

export function ScanForm() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Object-URL thumbnails, revoked when the set changes / on unmount.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  function clearStaleError() {
    // Clear a leftover message from a previous attempt: the inline one (client
    // state) and the top-of-page one (the server-rendered ?error= param).
    setError(null);
    router.replace("/medications/new");
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    clearStaleError();
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_PHOTOS));
  }

  function removeAt(i: number) {
    setFiles((prev) => prev.filter((_, j) => j !== i));
  }

  function extract() {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("document_type", "vial_photo"); // auto-detect switches if needed
        // Re-encode each photo to a downscaled JPEG so iPhone HEIC photos (which
        // the vision models reject) become a format they can read.
        for (const f of files) fd.append("photo", await toUploadJpeg(f));
        await uploadAndExtract(fd);
      } catch (err) {
        // A handled run ends in a redirect (re-thrown for the framework). This
        // only fires for an unexpected throw.
        if (isRedirectError(err)) throw err;
        setError(
          "Something went wrong starting the scan. Please try again, or enter the details manually below."
        );
      }
    });
  }

  const full = files.length >= MAX_PHOTOS;

  return (
    <section className="mt-6 rounded-md border border-line p-4 space-y-3">
      <h2 className="text-sm font-medium text-paper">Scan a photo</h2>
      <p className="text-xs text-faint">
        Take a photo of a vial, package, or prescription — we&rsquo;ll detect
        which it is and extract the details for you to review.
      </p>

      {isPending ? (
        <ExtractingIndicator count={files.length} />
      ) : (
        <div className="space-y-3">
          {/* Camera vs library are separate inputs so the camera option is
              always offered (some Android browsers skip it otherwise), and the
              library can pick several at once. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {previews.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Photo ${i + 1}`}
                    className="h-16 w-16 rounded-md border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-xs text-muted hover:text-paper"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={full}
              onClick={() => cameraRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper transition-colors hover:border-muted disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              Take photo
            </button>
            <button
              type="button"
              disabled={full}
              onClick={() => libraryRef.current?.click()}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper transition-colors hover:border-muted disabled:opacity-50"
            >
              {files.length > 0 ? "Add from photos" : "Choose photos"}
            </button>
          </div>

          {/* Multi-photo guidance — for curved vials / bottles whose label
              wraps out of one frame. */}
          <p className="text-xs text-faint">
            On a curved vial or bottle the label often won&rsquo;t fit in one
            shot. Add a few photos of the different sides
            {full ? " (max 5)" : ""} — we&rsquo;ll read them together.
          </p>

          {files.length > 0 ? (
            <button
              type="button"
              onClick={extract}
              className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              Extract {files.length} photo{files.length > 1 ? "s" : ""}
            </button>
          ) : null}

          {error ? (
            <p className="rounded-md border alert-error p-3 text-sm">{error}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Animated beaker filling indicator while the LLM works. */
function ExtractingIndicator({ count = 1 }: { count?: number }) {
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
          Reading {count > 1 ? `${count} photos` : "the photo"} and pulling out the details
        </p>
      </div>
    </div>
  );
}
