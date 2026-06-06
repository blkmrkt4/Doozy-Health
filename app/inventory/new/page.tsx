import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { createSyringe } from "@/app/inventory/actions";
import { SyringeScanForm } from "./syringe-scan-form";

// Add a syringe to inventory — scan the packaging or enter it manually
// (PRD §5.1). Owner-only.

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

export default async function NewSyringePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") redirect("/dashboard");

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Back
          </Link>
          <span className="text-xs text-faint">Add a syringe</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        <h1 className="text-lg font-medium text-paper">Add a syringe</h1>

        {error ? (
          <p className="rounded-md border alert-error p-3 text-sm">
            {error}
          </p>
        ) : null}

        <SyringeScanForm />

        <form action={createSyringe} className="space-y-4 rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">Or enter it manually</h2>
          <label className={labelCls}>
            Nickname
            <input
              type="text"
              name="label"
              placeholder="e.g. My TRT syringes"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-faint">
              A friendly name so you can spot it in your inventory. Optional — we
              will name it from the spec if you leave it blank.
            </span>
          </label>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Capacity (mL)
              <input type="number" name="capacity_ml" min={0} step="any" className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Needle gauge
              <input type="number" name="needle_gauge" min={0} step={1} className={`${inputCls} tabular`} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Needle length (in)
              <input type="number" name="needle_length_in" min={0} step="any" className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Unit markings
              <input type="text" name="unit_markings" placeholder="e.g. 0.01 mL increments" className={inputCls} />
            </label>
          </div>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Save syringe
          </button>
        </form>
      </main>
    </div>
  );
}
