"use client";

import { useEffect, useRef, useState } from "react";

type Result = {
  id: string;
  canonical_name: string;
  controlled_schedule: string | null;
};

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";

// Typeahead over the reference drug catalogue. Picking a match sets the hidden
// canonical_drug_id; typing a name with no match leaves it blank (free-text
// entry is still first-class — PRD §4.2). The visible field is `drug_name`,
// which the createMedication action reads as display_name.
export function DrugSearch() {
  const [value, setValue] = useState("");
  const [canonicalId, setCanonicalId] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/drugs/search?q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const json = (await res.json()) as { results: Result[] };
        setResults(json.results);
        setOpen(true);
      } catch {
        // aborted or offline — leave free-text entry working
      }
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [value]);

  // Close the suggestion list on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(r: Result) {
    setValue(r.canonical_name);
    setCanonicalId(r.id);
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-sm text-muted">
        Medication name
        <input
          type="text"
          name="drug_name"
          required
          autoComplete="off"
          placeholder="e.g. testosterone cypionate"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Editing the text invalidates any previously picked match.
            setCanonicalId("");
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          className={inputCls}
        />
      </label>
      {/* Hidden: the matched canonical drug id, if one was picked. */}
      <input type="hidden" name="canonical_drug_id" value={canonicalId} />

      {open && results.length > 0 ? (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-paper hover:bg-ink"
              >
                <span>{r.canonical_name}</span>
                {r.controlled_schedule ? (
                  <span className="text-xs text-faint">
                    {r.controlled_schedule}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {canonicalId ? (
        <p className="mt-1 text-xs text-accent">Matched in the drug reference.</p>
      ) : value.trim().length >= 2 ? (
        <p className="mt-1 text-xs text-faint">
          Not in the reference — saved as free text.
        </p>
      ) : null}
    </div>
  );
}
