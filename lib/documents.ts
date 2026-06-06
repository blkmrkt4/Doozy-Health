// Document/photo capture constants (PRD §5.1, §8). Mirrors the CHECK
// constraints and bucket config in the documents migration.

export const MAX_DOCUMENT_BYTES = 26_214_400; // 25 MB

export const DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

export const DOCUMENT_TYPES = [
  "vial_photo",
  "prescription_scan",
  "patch_box",
  "pill_bottle",
  "lab_result",
  "syringe_packaging",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  vial_photo: "Vial photo",
  prescription_scan: "Prescription",
  patch_box: "Patch box",
  pill_bottle: "Pill bottle",
  lab_result: "Lab result",
  syringe_packaging: "Syringe packaging",
  other: "Other",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export function isAllowedMime(mime: string): mime is DocumentMime {
  return (DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export function isDocumentType(v: string): v is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(v);
}

/** File extension for a storage key, from the MIME type. */
export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export const DOCUMENTS_BUCKET = "documents";
/** TTL for the short-lived signed URLs we hand to the browser (PRD §6.2). */
export const SIGNED_URL_TTL_SECONDS = 60;
