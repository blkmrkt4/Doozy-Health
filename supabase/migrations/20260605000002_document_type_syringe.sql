-- Doozy Health — allow 'syringe_packaging' as a document type so a syringe
-- packaging photo can be stored + extracted. Forward-only; widens the CHECK.
set search_path = public;

alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in
    ('vial_photo','prescription_scan','patch_box','pill_bottle','lab_result','syringe_packaging','other'));
