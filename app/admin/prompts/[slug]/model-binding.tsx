"use client";

import { useState } from "react";
import { saveBinding } from "@/app/admin/prompts/actions";
import { ModelPicker, type ModelRow } from "@/app/admin/_components/model-picker";
import { RESPONSE_FORMATS } from "@/lib/types";

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";
const sectionCls = "rounded-md border border-line p-4 space-y-4";
const btnPrimary =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90";

export function ModelBinding({
  slug,
  binding,
  models,
}: {
  slug: string;
  binding: {
    prompt_id: string;
    primary_model_slug: string;
    fallback_1_model_slug: string | null;
    fallback_2_model_slug: string | null;
    temperature: number;
    max_tokens: number;
    response_format: string;
    json_schema: unknown;
  } | null;
  models: ModelRow[];
}) {
  const [responseFormat, setResponseFormat] = useState(
    binding?.response_format ?? "text"
  );

  return (
    <form action={saveBinding} className={`${sectionCls} h-fit`}>
      <h2 className="text-sm font-medium text-paper">Model binding</h2>
      <input type="hidden" name="slug" value={slug} />

      <ModelPicker
        models={models}
        value={binding?.primary_model_slug ?? ""}
        name="primary_model_slug"
        required
        label="Primary model"
      />

      <ModelPicker
        models={models}
        value={binding?.fallback_1_model_slug ?? ""}
        name="fallback_1_model_slug"
        label="Fallback 1"
      />

      <ModelPicker
        models={models}
        value={binding?.fallback_2_model_slug ?? ""}
        name="fallback_2_model_slug"
        label="Fallback 2"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="temperature" className={labelCls}>
            Temperature
          </label>
          <input
            id="temperature"
            name="temperature"
            type="number"
            step="0.05"
            min="0"
            max="2"
            defaultValue={binding?.temperature ?? 0.2}
            className={`${inputCls} mt-1 tabular`}
          />
        </div>
        <div>
          <label htmlFor="max_tokens" className={labelCls}>
            Max tokens
          </label>
          <input
            id="max_tokens"
            name="max_tokens"
            type="number"
            step="256"
            min="1"
            defaultValue={binding?.max_tokens ?? 2048}
            className={`${inputCls} mt-1 tabular`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="response_format" className={labelCls}>
          Response format
        </label>
        <select
          id="response_format"
          name="response_format"
          value={responseFormat}
          onChange={(e) => setResponseFormat(e.target.value)}
          className={`${inputCls} mt-1`}
        >
          {RESPONSE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {responseFormat === "json" ? (
        <div>
          <label htmlFor="json_schema" className={labelCls}>
            JSON schema (optional)
          </label>
          <textarea
            id="json_schema"
            name="json_schema"
            rows={6}
            defaultValue={
              binding?.json_schema
                ? JSON.stringify(binding.json_schema, null, 2)
                : ""
            }
            placeholder='{"type": "object", "properties": {...}}'
            className={`${inputCls} mt-1 resize-y font-mono text-xs`}
          />
        </div>
      ) : null}

      <button type="submit" className={btnPrimary}>
        Save binding
      </button>
    </form>
  );
}
