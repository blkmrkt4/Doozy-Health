"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSystemAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents";

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

/**
 * Annotate an extraction delta (PRD §14.7). Changes the admin_annotation
 * from unreviewed → expected or extraction_miss. Logs to admin_audit_log.
 */
export async function annotateExtraction(formData: FormData) {
  const admin = await requireSystemAdmin();
  const deltaId = str(formData, "delta_id");
  const annotation = str(formData, "annotation");
  const returnPath = str(formData, "return_path") || "/admin/extractions";

  if (!deltaId || !["expected", "extraction_miss", "unreviewed"].includes(annotation)) {
    redirect(`${returnPath}?error=Invalid+annotation`);
  }

  const svc = createAdminClient();

  const { data: before } = await svc
    .from("extraction_deltas")
    .select("admin_annotation")
    .eq("id", deltaId)
    .single();

  const { error } = await svc
    .from("extraction_deltas")
    .update({ admin_annotation: annotation })
    .eq("id", deltaId);

  if (error) {
    redirect(
      `${returnPath}?error=${encodeURIComponent(`Annotation failed: ${error.message}`)}`
    );
  }

  await svc.from("admin_audit_log").insert({
    actor_id: admin.id,
    entity: "extraction_delta",
    entity_id: deltaId,
    action: "update",
    diff: {
      before: before?.admin_annotation,
      after: annotation,
    },
  });

  revalidatePath(returnPath);
  redirect(returnPath);
}

/**
 * Generate a short-lived signed URL for the source photo of an extraction
 * delta (PRD §14.7). Every view is audit-logged (§14.9).
 */
export async function viewExtractionSource(
  formData: FormData
): Promise<string | null> {
  const admin = await requireSystemAdmin();
  const deltaId = str(formData, "delta_id");
  const documentId = str(formData, "document_id");

  if (!deltaId || !documentId) return null;

  const svc = createAdminClient();

  // Load the document's storage path.
  const { data: doc } = await svc
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .single();

  if (!doc) return null;

  // Generate signed URL (short-lived).
  const { data: signed } = await svc.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (!signed?.signedUrl) return null;

  // Audit log the view (PRD §14.9).
  await svc.from("admin_audit_log").insert({
    actor_id: admin.id,
    entity: "extraction_delta",
    entity_id: deltaId,
    action: "view_source",
    diff: { document_id: documentId },
  });

  return signed.signedUrl;
}
