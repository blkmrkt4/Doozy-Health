import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents";
import { confirmSyringeExtraction } from "@/app/inventory/actions";

// Review a scanned syringe extraction, then confirm (PRD §5.2 — never
// auto-committed). American English.

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

type Field<T = string> = { value: T; confidence?: string };

function val(f: Field<unknown> | undefined): string {
  if (!f || f.value === null || f.value === undefined) return "";
  return String(f.value);
}

export default async function SyringeExtractReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; error?: string }>;
}) {
  const { doc: docId, error } = await searchParams;
  if (!docId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") redirect("/dashboard");

  const { data: docRow } = await supabase
    .from("documents")
    .select("id, storage_path, extracted_json")
    .eq("id", docId)
    .maybeSingle();
  if (!docRow) notFound();

  const ex = (docRow.extracted_json ?? {}) as Record<string, Field<unknown>>;

  let photoUrl: string | null = null;
  const { data: signed } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(docRow.storage_path as string, SIGNED_URL_TTL_SECONDS);
  if (signed?.signedUrl) photoUrl = signed.signedUrl;

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/inventory/new" className="text-sm text-faint hover:text-muted">
            ← Back
          </Link>
          <span className="text-xs text-faint">Review syringe</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        <h1 className="text-lg font-medium text-paper">Review the details</h1>

        {error ? (
          <p className="rounded-md border alert-error p-3 text-sm">
            {error} — you can still fill the fields in and save.
          </p>
        ) : null}

        {photoUrl ? (
          <Image
            src={photoUrl}
            alt="Syringe packaging"
            width={320}
            height={240}
            unoptimized
            className="max-h-48 w-auto rounded-md border border-line object-contain"
          />
        ) : null}

        <form action={confirmSyringeExtraction} className="space-y-4 rounded-md border border-line p-4">
          <input type="hidden" name="document_id" value={docId} />
          <label className={labelCls}>
            Nickname
            <input
              type="text"
              name="label"
              placeholder="e.g. My TRT syringes"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-faint">
              A friendly name. Optional — we will name it from the spec if blank.
            </span>
          </label>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Capacity (mL)
              <input type="number" name="capacity_ml" min={0} step="any" defaultValue={val(ex.capacity_ml)} className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Needle gauge
              <input type="number" name="needle_gauge" min={0} step={1} defaultValue={val(ex.needle_gauge)} className={`${inputCls} tabular`} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Needle length (in)
              <input type="number" name="needle_length_in" min={0} step="any" defaultValue={val(ex.needle_length_in)} className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Unit markings
              <input type="text" name="unit_markings" defaultValue={val(ex.unit_markings)} className={inputCls} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Manufacturer
              <input type="text" name="manufacturer" defaultValue={val(ex.manufacturer)} className={inputCls} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Batch / lot
              <input type="text" name="batch" defaultValue={val(ex.batch)} className={inputCls} />
            </label>
          </div>
          <label className={labelCls}>
            How many do you have?
            <input type="number" name="quantity" min={0} step={1} inputMode="numeric" className={`${inputCls} tabular`} />
            <span className="mt-1 block text-xs text-faint">
              Optional. With a count, the supply estimate can note when this is
              projected to run out, based on what you log.
            </span>
          </label>
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
