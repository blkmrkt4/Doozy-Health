"use client";

import { useState, useMemo } from "react";
import { updatePrompt, savePromptBody } from "@/app/admin/prompts/actions";
import { PROMPT_PURPOSES, PROMPT_STATUSES } from "@/lib/types";

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";
const sectionCls = "rounded-md border border-line p-4 space-y-4";
const btnPrimary =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90";
const btnSecondary =
  "rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface";

export function PromptEditor({
  slug,
  name: initName,
  description: initDesc,
  purpose: initPurpose,
  status: initStatus,
  body: initBody,
  availableSlugs: initSlugs,
  versionNumber,
  history,
}: {
  slug: string;
  name: string;
  description: string;
  purpose: string;
  status: string;
  body: string;
  availableSlugs: string[];
  versionNumber: number;
  history: Array<{
    id: string;
    version_number: number;
    notes: string;
    created_by: string | null;
    created_at: string;
  }>;
}) {
  const [body, setBody] = useState(initBody);
  const [slugs, setSlugs] = useState<string[]>(initSlugs);
  const [newSlug, setNewSlug] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Typo guard: find {{...}} in body not in the declared list (PRD §14.4.2).
  const undeclaredVars = useMemo(() => {
    const used = new Set<string>();
    const re = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      used.add(m[1]);
    }
    return [...used].filter((v) => !slugs.includes(v));
  }, [body, slugs]);

  function addSlug() {
    const s = newSlug.trim().toLowerCase();
    if (s && !slugs.includes(s)) {
      setSlugs([...slugs, s]);
    }
    setNewSlug("");
  }

  function removeSlug(s: string) {
    setSlugs(slugs.filter((x) => x !== s));
  }

  return (
    <div className="space-y-6">
      {/* ── Metadata form ───────────────────────────────────────── */}
      <form action={updatePrompt} className={sectionCls}>
        <h2 className="text-sm font-medium text-paper">Prompt metadata</h2>
        <input type="hidden" name="slug" value={slug} />

        <div>
          <label className={labelCls}>Slug</label>
          <p className="mt-1 font-mono text-sm text-faint">{slug}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className={labelCls}>
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={initName}
              required
              className={`${inputCls} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="purpose" className={labelCls}>
              Purpose
            </label>
            <select
              id="purpose"
              name="purpose"
              defaultValue={initPurpose}
              className={`${inputCls} mt-1`}
            >
              {PROMPT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="description" className={labelCls}>
            Description
          </label>
          <input
            id="description"
            name="description"
            defaultValue={initDesc}
            className={`${inputCls} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="status" className={labelCls}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initStatus}
            className={`${inputCls} mt-1`}
          >
            {PROMPT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className={btnPrimary}>
          Save metadata
        </button>
      </form>

      {/* ── Body editor ─────────────────────────────────────────── */}
      <form action={savePromptBody} className={sectionCls}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-paper">
            Prompt body{" "}
            <span className="text-xs text-faint">v{versionNumber}</span>
          </h2>
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-muted hover:text-paper"
          >
            {showHistory ? "Hide history" : "Version history"}
          </button>
        </div>

        <input type="hidden" name="slug" value={slug} />
        <input
          type="hidden"
          name="available_slugs"
          value={JSON.stringify(slugs)}
        />

        {/* Available slugs (tag editor) */}
        <div>
          <label className={labelCls}>Available variables</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {slugs.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 font-mono text-xs text-paper"
              >
                {`{{${s}}}`}
                <button
                  type="button"
                  onClick={() => removeSlug(s)}
                  className="text-faint hover:text-red-400"
                >
                  x
                </button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSlug();
                  }
                }}
                placeholder="add..."
                className="w-24 rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-paper outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={addSlug}
                className="text-xs text-muted hover:text-paper"
              >
                +
              </button>
            </span>
          </div>
        </div>

        {/* Typo guard warning */}
        {undeclaredVars.length > 0 ? (
          <p className="rounded-md border border-yellow-900 bg-yellow-950/30 p-2 text-xs text-yellow-300">
            Undeclared variables in body:{" "}
            {undeclaredVars.map((v) => `{{${v}}}`).join(", ")}
          </p>
        ) : null}

        {/* Body textarea */}
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          required
          className={`${inputCls} mt-1 resize-y font-mono text-xs leading-relaxed`}
        />

        <div>
          <label htmlFor="notes" className={labelCls}>
            Version notes
          </label>
          <input
            id="notes"
            name="notes"
            placeholder="What changed?"
            className={`${inputCls} mt-1`}
          />
        </div>

        <button type="submit" className={btnPrimary}>
          Save as v{versionNumber + 1}
        </button>
      </form>

      {/* ── Version history ─────────────────────────────────────── */}
      {showHistory ? (
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-paper">Version history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-faint">No versions.</p>
          ) : (
            <ul className="divide-y divide-line">
              {history.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="tabular font-mono text-xs text-accent">
                    v{v.version_number}
                  </span>
                  <span className="flex-1 text-muted">{v.notes || "—"}</span>
                  <span className="text-xs text-faint">
                    {new Date(v.created_at).toLocaleDateString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
