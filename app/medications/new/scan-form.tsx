"use client";

import { useRef, useState, useTransition } from "react";
import { uploadAndExtract } from "@/app/medications/actions";

// Scan form with smart UX: Extract button opens file picker if no file
// chosen, shows a loading animation while the LLM processes, and submits
// when a file is ready.

export function ScanForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleExtractClick() {
    if (!hasFile) {
      // No file selected — open the file picker.
      fileRef.current?.click();
      return;
    }
    // File is selected — submit the form.
    const form = fileRef.current?.closest("form");
    if (form) {
      startTransition(() => {
        const fd = new FormData(form);
        uploadAndExtract(fd);
      });
    }
  }

  return (
    <section className="mt-6 rounded-md border border-line p-4 space-y-3">
      <h2 className="text-sm font-medium text-paper">Scan a photo</h2>
      <p className="text-xs text-faint">
        Take a photo of a vial, package, or prescription and we will extract
        the details for you to review.
      </p>

      {isPending ? (
        <ExtractingIndicator />
      ) : (
        <form action={uploadAndExtract} className="space-y-3">
          <div className="flex gap-3">
            <label className="block text-sm text-muted">
              Type
              <select
                name="document_type"
                defaultValue="vial_photo"
                className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
              >
                <option value="vial_photo">Vial / package</option>
                <option value="prescription_scan">Prescription</option>
              </select>
            </label>
          </div>
          <div className="flex items-end gap-3">
            <input
              ref={fileRef}
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/heic,image/heif"
              capture="environment"
              onChange={() => setHasFile(Boolean(fileRef.current?.files?.length))}
              className="flex-1 text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-muted"
            />
            <button
              type="button"
              onClick={handleExtractClick}
              className="shrink-0 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              {hasFile ? "Extract" : "Choose photo"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Animated beaker filling indicator while the LLM works. */
function ExtractingIndicator() {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      {/* SVG beaker with filling animation */}
      <div className="relative">
        <svg width="64" height="80" viewBox="0 0 64 80" className="overflow-visible">
          {/* Beaker outline */}
          <path
            d="M 18 10 L 18 30 L 8 65 Q 6 72 12 75 L 52 75 Q 58 72 56 65 L 46 30 L 46 10"
            fill="none"
            stroke="#555555"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Beaker rim */}
          <line x1="14" y1="10" x2="50" y2="10" stroke="#555555" strokeWidth="2" strokeLinecap="round" />

          {/* Filling liquid — animated */}
          <clipPath id="beaker-clip">
            <path d="M 18 30 L 8 65 Q 6 72 12 75 L 52 75 Q 58 72 56 65 L 46 30 Z" />
          </clipPath>
          <rect
            x="6"
            y="75"
            width="52"
            height="50"
            fill="#F4EE35"
            opacity="0.3"
            clipPath="url(#beaker-clip)"
          >
            <animate
              attributeName="y"
              from="75"
              to="28"
              dur="3s"
              repeatCount="indefinite"
            />
          </rect>

          {/* Bubbles */}
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
