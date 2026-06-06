"use client";

import { useState, useTransition } from "react";
import { testPrompt } from "@/app/admin/prompts/actions";
import type { LlmCallResult } from "@/lib/llm";

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";
const sectionCls = "rounded-md border border-line p-4 space-y-4";
const btnPrimary =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50";

export function TestPanel({
  slug,
  availableSlugs,
}: {
  slug: string;
  availableSlugs: string[];
}) {
  const [result, setResult] = useState<LlmCallResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await testPrompt(formData);
      setResult(res);
    });
  }

  return (
    <div className={sectionCls}>
      <h2 className="text-sm font-medium text-paper">Test panel</h2>
      <p className="text-xs text-faint">
        Runs the prompt against the bound primary model. Max 10 tests/min.
      </p>

      <form action={handleSubmit} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />

        {/* Variable inputs */}
        {availableSlugs.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {availableSlugs.map((s) => (
              <div key={s}>
                <label htmlFor={`var_${s}`} className={labelCls}>
                  {`{{${s}}}`}
                </label>
                <input
                  id={`var_${s}`}
                  name={`var_${s}`}
                  className={`${inputCls} mt-1 font-mono text-xs`}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">No variables declared.</p>
        )}

        {/* Image attachment */}
        <div>
          <label htmlFor="test_images" className={labelCls}>
            Attach images (optional)
          </label>
          <input
            id="test_images"
            name="test_images"
            type="file"
            accept="image/*"
            multiple
            className="mt-1 text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-muted"
          />
        </div>

        <button type="submit" disabled={isPending} className={btnPrimary}>
          {isPending ? "Running..." : "Run test"}
        </button>
      </form>

      {/* Result display */}
      {result ? (
        <div className="space-y-2 border-t border-line pt-4">
          <div className="flex items-center gap-3 text-sm">
            {result.ok ? (
              <>
                <span className="text-green-400">Success</span>
                <span className="text-xs text-muted">
                  model: {result.modelUsed}
                </span>
                {result.wasFallback > 0 ? (
                  <span className="text-xs text-faint">
                    (fallback {result.wasFallback})
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-red-400">Failed: {result.error}</span>
            )}
          </div>

          {result.ok ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-surface p-3 font-mono text-xs text-paper">
              {result.text}
            </pre>
          ) : result.attempts.length > 0 ? (
            <div className="space-y-1 text-xs text-faint">
              {result.attempts.map((a, i) => (
                <p key={i}>
                  Attempt {i + 1} ({a.model}): {a.error} — {a.latencyMs}ms
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
