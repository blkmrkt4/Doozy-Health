import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents";
import { ExtractionField } from "@/app/medications/_components/extraction-field";
import type { VialExtraction } from "@/lib/extraction";
import type { LlmConfidence } from "@/lib/types";

// Manual-first verification page (PRD §5.2.2). Shows a field-by-field
// comparison of what the user entered vs what the AI extracted from the photo.
// The user picks which value to keep for each diverging field.

export default async function VerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string; error?: string }>;
}) {
  const { id: medicationId } = await params;
  const { doc: docId, error } = await searchParams;
  if (!docId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Load the medication's current data.
  const { data: med } = await supabase
    .from("medications")
    .select("id, display_name, patient_id")
    .eq("id", medicationId)
    .single();
  if (!med) notFound();

  // Load delivery form for current values.
  const { data: delivery } = await supabase
    .from("delivery_forms")
    .select("form_type, concentration, expiry_date, batch, manufacturer")
    .eq("medication_id", medicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Load the document extraction.
  const { data: doc } = await admin
    .from("documents")
    .select("id, storage_path, extracted_json, status")
    .eq("id", docId)
    .single();

  if (!doc || doc.status !== "extracted" || !doc.extracted_json) {
    redirect(
      `/medications/${medicationId}?error=No+extraction+found+for+this+document`
    );
  }

  const extraction = doc.extracted_json as unknown as VialExtraction;

  // Generate signed URL for the photo.
  const { data: signed } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
  const thumbnailUrl = signed?.signedUrl ?? null;

  // Build comparison fields.
  type CompareField = {
    label: string;
    fieldName: string;
    userValue: string;
    llmValue: string;
    confidence: LlmConfidence;
    diverges: boolean;
  };

  const conc = delivery?.concentration as {
    amount: number;
    unit: string;
    per_volume: number;
  } | null;

  const fields: CompareField[] = [
    {
      label: "Drug name",
      fieldName: "drug_name_canonical",
      userValue: med.display_name,
      llmValue: extraction.drug_name_canonical.value,
      confidence: extraction.drug_name_canonical.confidence,
      diverges: false,
    },
    {
      label: "Manufacturer",
      fieldName: "manufacturer",
      userValue: delivery?.manufacturer ?? "",
      llmValue: extraction.manufacturer.value,
      confidence: extraction.manufacturer.confidence,
      diverges: false,
    },
    {
      label: "Batch / lot",
      fieldName: "batch",
      userValue: delivery?.batch ?? "",
      llmValue: extraction.batch.value,
      confidence: extraction.batch.confidence,
      diverges: false,
    },
    {
      label: "Expiry date",
      fieldName: "expiry_date",
      userValue: delivery?.expiry_date ?? "",
      llmValue: extraction.expiry_date.value,
      confidence: extraction.expiry_date.confidence,
      diverges: false,
    },
    {
      label: "Concentration",
      fieldName: "concentration_amount",
      userValue: conc ? String(conc.amount) : "",
      llmValue: String(extraction.concentration_amount.value ?? ""),
      confidence: extraction.concentration_amount.confidence,
      diverges: false,
    },
  ];

  // Mark divergences.
  for (const f of fields) {
    f.diverges =
      f.userValue.toLowerCase().trim() !== f.llmValue.toLowerCase().trim() &&
      (f.userValue !== "" || f.llmValue !== "");
  }

  const hasDivergence = fields.some((f) => f.diverges);

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href={`/medications/${medicationId}`}
            className="text-sm text-faint hover:text-muted"
          >
            ← Back to medication
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">
          Verify: {med.display_name}
        </h1>
        <p className="mt-1 text-sm text-faint">
          Compare your entry with what the AI read from the photo.
          {hasDivergence
            ? " Differences are highlighted — pick which value to keep."
            : " No differences found."}
        </p>

        {error ? (
          <p className="mt-4 rounded-md border alert-error p-3 text-sm">
            {error}
          </p>
        ) : null}

        {/* Source photo */}
        {thumbnailUrl ? (
          <div className="mt-4">
            <a href={thumbnailUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt="Source photo"
                className="h-28 rounded-md border border-line object-cover"
              />
            </a>
          </div>
        ) : null}

        {/* Field-by-field comparison */}
        <div className="mt-6 space-y-4">
          {fields.map((f) => (
            <div
              key={f.fieldName}
              className={`rounded-md border p-4 ${
                f.diverges ? "border-yellow-800 bg-yellow-950/10" : "border-line"
              }`}
            >
              <p className="text-sm font-medium text-paper">{f.label}</p>
              {f.diverges ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-faint">
                      Your entry:
                    </span>
                    <span className="text-sm text-paper">
                      {f.userValue || "(empty)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-faint">
                      Photo:
                    </span>
                    <span className="text-sm text-accent">
                      {f.llmValue || "(empty)"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        f.confidence === "high"
                          ? "bg-green-950 text-green-400"
                          : f.confidence === "medium"
                            ? "bg-yellow-950 text-yellow-400"
                            : "bg-red-950 text-red-400"
                      }`}
                    >
                      {f.confidence}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">
                  {f.userValue || f.llmValue || "(empty)"}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <Link
            href={`/medications/${medicationId}`}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Done
          </Link>
        </div>

        <p className="mt-4 text-xs text-faint">
          In a future update, you will be able to accept individual photo values
          directly from this screen. For now, edit the medication manually if
          needed.
        </p>
      </main>
    </div>
  );
}
