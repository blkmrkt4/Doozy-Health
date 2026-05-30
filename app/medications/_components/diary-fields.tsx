"use client";

// Inline diary field inputs (PRD §5.9). Reused on the medication detail page
// (attached to a dose) and the free-standing diary page.

type TrackedField = {
  id: string;
  name: string;
  field_type: string;
  unit: string | null;
  category_options: string[] | null;
};

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

export function DiaryFields({ fields }: { fields: TrackedField[] }) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.id}>
          <label
            htmlFor={`field_${f.id}`}
            className="block text-sm text-muted"
          >
            {f.name}
            {f.unit ? (
              <span className="ml-1 text-xs text-faint">({f.unit})</span>
            ) : null}
          </label>

          {f.field_type === "scale_1_10" ? (
            <input
              id={`field_${f.id}`}
              name={`field_${f.id}`}
              type="range"
              min="1"
              max="10"
              defaultValue="5"
              className="mt-1 w-full accent-accent"
            />
          ) : f.field_type === "number" ? (
            <input
              id={`field_${f.id}`}
              name={`field_${f.id}`}
              type="number"
              step="any"
              placeholder="0"
              className={`${inputCls} mt-1 tabular`}
            />
          ) : f.field_type === "boolean" ? (
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                name={`bool_field_${f.id}`}
                value="true"
                className="accent-accent"
              />
              <span className="text-sm text-paper">Yes</span>
            </label>
          ) : f.field_type === "category" && f.category_options ? (
            <select
              id={`field_${f.id}`}
              name={`field_${f.id}`}
              className={`${inputCls} mt-1`}
            >
              <option value="">—</option>
              {(f.category_options as string[]).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`field_${f.id}`}
              name={`field_${f.id}`}
              type="text"
              placeholder="Notes..."
              className={`${inputCls} mt-1`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
