-- Owner-only hard delete of a medication (PRD §5.6 write model).
--
-- Archiving (UPDATE archived = true) stays the soft option — it hides a
-- medication but keeps its history, charts, and report inclusion so it can be
-- added back. A true delete is for a medication entered by mistake, or one the
-- user no longer wants reflected anywhere (charts, the clinician PDF). Every
-- medication-owned child row cascades via existing FKs (prescribed_regimens,
-- delivery_forms, chosen_regimens, dose_logs, dose_schedules, dose_reminders,
-- pk_calibrations, tracked_field_medications); documents unlink
-- (linked_medication_id on delete set null); diary_entries.attached_dose_log_id
-- also on delete set null. RLS only needs a policy on the parent — cascaded
-- deletes are not subject to child-table RLS.
create policy medications_owner_delete on public.medications
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
