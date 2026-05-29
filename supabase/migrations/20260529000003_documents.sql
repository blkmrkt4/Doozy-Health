-- Doozy Health — documents + private storage (build sequence §13.5; PRD §5.1,
-- §6.2, §7, §8). Photo/PDF capture, linked to a medication. No extraction yet
-- (that's step 8) — status stays 'uploaded'.
--
-- STORAGE SCOPING (the §7 departure applied to storage): object keys are
-- <patient_id>/<doc_id>.<ext>, and storage RLS checks the FIRST path segment
-- against the caller's MEMBERSHIP SET — not Numara's single current_*_id().
--
-- is_private (PRD §5.6) is honoured for reads: the documents read policy (and,
-- transitively, the storage read policy via an EXISTS on documents) hides a
-- document linked to a private medication from non-owners.
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text not null unique,        -- equals storage.objects.name
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  document_type text not null default 'other'
    check (document_type in
      ('vial_photo','prescription_scan','patch_box','pill_bottle','lab_result','other')),
  linked_medication_id uuid references public.medications(id) on delete set null,
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  extracted_json jsonb,                      -- populated by extraction (step 8)
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','extracted','failed')),
  created_at timestamptz not null default now()
);

create index documents_patient_idx on public.documents (patient_id, uploaded_at desc);
create index documents_medication_idx
  on public.documents (linked_medication_id)
  where linked_medication_id is not null;

-- Wire up the FKs deferred from earlier steps ("FK to documents added in
-- step 5").
alter table public.delivery_forms
  add constraint delivery_forms_source_photo_fkey
  foreign key (source_photo_id) references public.documents(id) on delete set null;

alter table public.prescribed_regimens
  add constraint prescribed_regimens_doc_fkey
  foreign key (prescription_document_id) references public.documents(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- documents RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.documents enable row level security;

-- Read: a member of the patient, honouring is_private through the linked
-- medication (an unlinked document is visible to any member).
create policy documents_read on public.documents
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships where user_id = auth.uid()
    )
    and (
      linked_medication_id is null
      or public.can_read_medication(linked_medication_id)
    )
  );

-- Insert: an owner or caregiver of the patient, uploading as themselves.
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner','caregiver')
    )
  );

-- Update (e.g. (un)linking a medication): owner or caregiver of the patient.
create policy documents_update on public.documents
  for update to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner','caregiver')
    )
  )
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner','caregiver')
    )
  );

-- Delete: the uploader or an owner.
create policy documents_delete on public.documents
  for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Private storage bucket + RLS on storage.objects (PRD §5.1, §7).
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array['image/jpeg','image/png','image/heic','image/heif','application/pdf']
)
on conflict (id) do nothing;

-- Upload: an owner or caregiver, into THEIR patient's folder (first path
-- segment = a patient_id from the caller's membership set).
create policy "documents_objects_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select patient_id::text from public.patient_memberships
      where user_id = auth.uid() and role in ('owner','caregiver')
    )
  );

-- Read: only when a documents row for this object is visible to the caller.
-- That EXISTS runs under the documents read policy above, so membership AND
-- is_private are both enforced at the storage layer too.
create policy "documents_objects_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d where d.storage_path = name
    )
  );

-- Delete: the patient's owner (folder check).
create policy "documents_objects_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (
      select patient_id::text from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
