"use client";

import { useState } from "react";
import { ModelPicker, type ModelRow } from "@/app/admin/_components/model-picker";
import {
  saveApiKey,
  saveDefaultModels,
  refreshModelCatalogue,
  revealOpenRouterKey,
} from "./actions";

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";
const btnPrimary =
  "rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90";
const btnSecondary =
  "rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface";
const sectionCls = "rounded-md border border-line p-4 space-y-4";

/**
 * Owner-only reveal + copy of the stored OpenRouter key, so it can be reused on
 * another machine. The decrypt happens server-side (revealOpenRouterKey, which
 * audit-logs every reveal); the value is held in local state only, and auto-
 * hides after 30s.
 */
function RevealKey() {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function reveal() {
    setError(null);
    setPending(true);
    const res = await revealOpenRouterKey();
    setPending(false);
    if (res.ok) {
      setValue(res.value);
      window.setTimeout(() => setValue(null), 30_000);
    } else {
      setError(res.error);
    }
  }

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to the clipboard — select and copy manually.");
    }
  }

  if (value) {
    return (
      <div className="space-y-1">
        <div className="flex gap-3">
          <input
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className={`${inputCls} flex-1 font-mono`}
          />
          <button type="button" onClick={copy} className={btnSecondary}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => setValue(null)} className={btnSecondary}>
            Hide
          </button>
        </div>
        <p className="text-xs text-faint">
          Full key — system admins only, and every reveal is logged. Auto-hides in
          30 seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={reveal}
        disabled={pending}
        className={`${btnSecondary} disabled:opacity-50`}
      >
        {pending ? "Revealing…" : "Reveal & copy key"}
      </button>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

export function SettingsForms({
  apiKeyMasked,
  apiKeyUpdatedAt,
  defaultPrimary,
  defaultFallback1,
  defaultFallback2,
  models,
  availableCount,
  totalCount,
  lastSynced,
}: {
  apiKeyMasked: string | null;
  apiKeyUpdatedAt: string | null;
  defaultPrimary: string;
  defaultFallback1: string;
  defaultFallback2: string;
  models: ModelRow[];
  availableCount: number;
  totalCount: number;
  lastSynced: string | null;
}) {
  return (
    <div className="space-y-8">
      {/* ── API key ─────────────────────────────────────────────────── */}
      <section className={sectionCls}>
        <h2 className="text-lg font-medium">OpenRouter API key</h2>
        {apiKeyMasked ? (
          <>
            <p className="font-mono text-sm text-muted">
              Current: <span className="text-paper">{apiKeyMasked}</span>
              {apiKeyUpdatedAt ? (
                <span className="ml-2 text-xs text-faint">
                  (updated{" "}
                  {new Date(apiKeyUpdatedAt).toLocaleDateString("en-GB")})
                </span>
              ) : null}
            </p>
            <RevealKey />
          </>
        ) : (
          <p className="text-sm text-faint">No key configured.</p>
        )}
        <form action={saveApiKey} className="flex gap-3">
          <input
            type="password"
            name="api_key"
            placeholder="sk-or-v1-..."
            required
            className={`${inputCls} flex-1`}
          />
          <button type="submit" className={btnPrimary}>
            Save key
          </button>
        </form>
      </section>

      {/* ── Default models ──────────────────────────────────────────── */}
      <section className={sectionCls}>
        <h2 className="text-lg font-medium">Default models</h2>
        <p className="text-xs text-faint">
          New prompts inherit these. Change per-prompt in the Prompts page.
        </p>
        <form action={saveDefaultModels} className="space-y-4">
          <ModelPicker
            models={models}
            value={defaultPrimary}
            name="default_primary"
            required
            label="Primary"
          />
          <ModelPicker
            models={models}
            value={defaultFallback1}
            name="default_fallback_1"
            label="Fallback 1"
          />
          <ModelPicker
            models={models}
            value={defaultFallback2}
            name="default_fallback_2"
            label="Fallback 2"
          />
          <button type="submit" className={btnPrimary}>
            Save defaults
          </button>
        </form>
      </section>

      {/* ── Model catalogue ─────────────────────────────────────────── */}
      <section className={sectionCls}>
        <h2 className="text-lg font-medium">Model catalogue</h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">
            <span className="tabular text-paper">{availableCount}</span>{" "}
            available /{" "}
            <span className="tabular text-paper">{totalCount}</span> total
          </span>
          {lastSynced ? (
            <span className="text-xs text-faint">
              Last synced{" "}
              {new Date(lastSynced).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : (
            <span className="text-xs text-faint">Never synced</span>
          )}
        </div>
        <form action={refreshModelCatalogue}>
          <button type="submit" className={btnSecondary}>
            Refresh now
          </button>
        </form>
      </section>
    </div>
  );
}
