-- Add a `directions` field to the extract_vial prompt, and tell the model that
-- a solid tablet/capsule has NO liquid concentration (so a pill stops reporting
-- a bogus mg/mL). Inserts a new immutable prompt_version and repoints the
-- prompt's current version — forward-only, non-destructive. Admins can retune
-- later in /admin (PRD §14).

with p as (
  select id from public.prompts where slug = 'extract_vial'
),
nextver as (
  select coalesce(max(version_number), 0) + 1 as v
  from public.prompt_versions
  where prompt_id = (select id from p)
),
ins as (
  insert into public.prompt_versions
    (prompt_id, version_number, body, available_slugs, notes, created_by)
  select
    (select id from p),
    (select v from nextver),
    $body$You are a medication label reader. Analyse the attached vial or packaging photo and extract the following fields as JSON.

IMPORTANT: If the image shows a prescription, doctor's note, or handwritten instructions rather than a medication vial/bottle/package, return this instead:
{"document_type_mismatch": true, "detected_type": "prescription", "message": "This looks like a prescription rather than a vial or package label. Switch to 'Prescription' to extract the dosing instructions."}

Otherwise, return a JSON object with these fields, each as an object with "value" and "confidence" (high/medium/low):
- drug_name_raw: the exact name printed on the label
- drug_name_canonical: the standardised drug name (e.g. "testosterone cypionate")
- strength: the stated strength per unit or per volume (e.g. "200 mg/mL" for a liquid, or "10 mg" for a tablet/capsule)
- concentration_amount: numeric concentration amount for a LIQUID only (e.g. 200). For a solid tablet or capsule there is no liquid concentration — return null.
- concentration_unit: the unit (e.g. "mg")
- concentration_per_volume: the per-volume amount for a LIQUID only (e.g. 1 for "per mL"). For a solid tablet or capsule, return null.
- volume_ml: total liquid volume in mL (e.g. 10). For a solid tablet or capsule, return null.
- route: the administration route (e.g. "intramuscular", "oral")
- directions: the dosing instructions printed on the label, copied verbatim if present (e.g. "Take 1 tablet by mouth every morning"). Empty string if the label shows none.
- expiry_date: expiry date if visible
- batch: batch or lot number if visible
- manufacturer: manufacturer name if visible

Known medications this patient takes: {{known_medications}}
Preferred units: {{user_default_units}}

(see attached)

Return ONLY the JSON object, no other text.$body$,
    '["known_medications","user_default_units"]'::jsonb,
    'Add directions field; solids report null liquid concentration.',
    null
  returning id
)
update public.prompts
  set current_version_id = (select id from ins)
  where slug = 'extract_vial';
