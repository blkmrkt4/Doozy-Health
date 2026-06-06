import { createPrompt } from "@/app/admin/prompts/actions";
import { PROMPT_PURPOSES } from "@/lib/types";

// New prompt form (PRD §14.4.1). Creates a prompt + version 1 + binding
// with defaults from system_settings, then redirects to the detail page.

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

export default async function NewPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">New prompt</h1>

      {error ? (
        <p className="rounded-md border alert-error p-3 text-sm">
          {error}
        </p>
      ) : null}

      <form action={createPrompt} className="space-y-4">
        <div>
          <label htmlFor="slug" className={labelCls}>
            Slug
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="^[a-z][a-z0-9_]*$"
            placeholder="e.g. extract_vial"
            className={`${inputCls} mt-1 font-mono`}
          />
          <p className="mt-1 text-xs text-faint">
            Lowercase letters, numbers, and underscores. Immutable once
            referenced in code.
          </p>
        </div>

        <div>
          <label htmlFor="name" className={labelCls}>
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="e.g. Extract vial"
            className={`${inputCls} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="description" className={labelCls}>
            Description
          </label>
          <input
            id="description"
            name="description"
            type="text"
            placeholder="Optional — what this prompt does"
            className={`${inputCls} mt-1`}
          />
        </div>

        <div>
          <label htmlFor="purpose" className={labelCls}>
            Purpose
          </label>
          <select id="purpose" name="purpose" className={`${inputCls} mt-1`}>
            {PROMPT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Create prompt
          </button>
          <a
            href="/admin/prompts"
            className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
