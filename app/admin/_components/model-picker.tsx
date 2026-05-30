"use client";

import { useState, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelRow = {
  slug: string;
  name: string;
  provider: string;
  context_length: number | null;
  input_cost_per_mtoken: number | null;
  output_cost_per_mtoken: number | null;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_json_mode: boolean;
  is_coding_specialist: boolean;
  is_reasoning_specialist: boolean;
  is_available: boolean;
};

type SortKey = "name" | "cost" | "context";

// ── Capability badges (PRD §14.5) ─────────────────────────────────────────

const BADGES: {
  key: keyof ModelRow;
  label: string;
  title: string;
}[] = [
  { key: "supports_vision", label: "V", title: "Vision" },
  { key: "is_coding_specialist", label: "C", title: "Coding" },
  { key: "is_reasoning_specialist", label: "R", title: "Reasoning" },
  { key: "supports_tools", label: "T", title: "Tools" },
  { key: "supports_json_mode", label: "J", title: "JSON" },
];

function costStr(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function ctxStr(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ── Component ──────────────────────────────────────────────────────────────

export function ModelPicker({
  models,
  value,
  name,
  required = false,
  label,
}: {
  models: ModelRow[];
  value: string;
  name: string;
  required?: boolean;
  label: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(value);
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        // Capability search.
        (q === "vision" && m.supports_vision) ||
        (q === "coding" && m.is_coding_specialist) ||
        (q === "reasoning" && m.is_reasoning_specialist) ||
        (q === "tools" && m.supports_tools) ||
        (q === "json" && m.supports_json_mode)
    );

    list.sort((a, b) => {
      // Unavailable models always sort last.
      if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;

      switch (sortBy) {
        case "cost":
          return (a.input_cost_per_mtoken ?? Infinity) - (b.input_cost_per_mtoken ?? Infinity);
        case "context":
          return (b.context_length ?? 0) - (a.context_length ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return list;
  }, [models, search, sortBy]);

  const selectedModel = models.find((m) => m.slug === selected);

  return (
    <div className="space-y-1">
      <label className="block text-sm text-muted">{label}</label>
      <input type="hidden" name={name} value={selected} />

      {/* Selected model display */}
      {selectedModel ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <span className="flex-1 truncate text-sm text-paper">
            {selectedModel.name}
          </span>
          <span className="text-xs text-faint">{selectedModel.provider}</span>
          <button
            type="button"
            onClick={() => {
              if (!required) setSelected("");
              setOpen(true);
            }}
            className="text-xs text-muted hover:text-paper"
          >
            {required ? "Change" : "Clear"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full rounded-md border border-dashed border-line bg-surface px-3 py-2 text-left text-sm text-faint hover:border-muted"
        >
          Select a model...
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className="rounded-md border border-line bg-ink">
          {/* Search + sort controls */}
          <div className="flex gap-2 border-b border-line p-2">
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 rounded border border-line bg-surface px-2 py-1 text-sm text-paper outline-none focus:border-accent"
              autoFocus
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded border border-line bg-surface px-2 py-1 text-xs text-muted"
            >
              <option value="name">Name</option>
              <option value="cost">Cost</option>
              <option value="context">Context</option>
            </select>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-muted hover:text-paper"
            >
              Close
            </button>
          </div>

          {/* Model list */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-3 text-sm text-faint">No models found.</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  disabled={!m.is_available}
                  onClick={() => {
                    setSelected(m.slug);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    m.is_available
                      ? "hover:bg-surface"
                      : "cursor-not-allowed opacity-40"
                  } ${m.slug === selected ? "bg-surface" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-paper">
                    {m.name}
                  </span>

                  {/* Capability badges */}
                  <span className="flex shrink-0 gap-0.5">
                    {BADGES.map((b) =>
                      m[b.key] ? (
                        <span
                          key={b.label}
                          title={b.title}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-line text-[10px] font-medium text-muted"
                        >
                          {b.label}
                        </span>
                      ) : null
                    )}
                  </span>

                  {/* Cost */}
                  <span className="tabular shrink-0 text-xs text-faint">
                    {costStr(m.input_cost_per_mtoken)}/
                    {costStr(m.output_cost_per_mtoken)}
                  </span>

                  {/* Context */}
                  <span className="tabular shrink-0 text-xs text-faint">
                    {ctxStr(m.context_length)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
