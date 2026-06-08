-- Reconstitution-aware extraction prompts (PRD §5.2, §14).
--   • extract_vial: detect a lyophilized POWDER vial that must be mixed with a
--     diluent before use, and read the active amount (e.g. 5000 IU). With
--     multiple photos it can read a powder vial AND a separate water vial.
--   • extract_prescription: author its real body (it shipped as a placeholder)
--     and have it read the reconstitution MIX VOLUME the prescriber specified.
-- Forward-only: each block inserts a new immutable prompt_version and repoints
-- the prompt's current version. Admins can retune in /admin afterwards.

-- ── extract_vial: + reconstitution detection ────────────────────────────────
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
    $body$You are a medication label reader. Analyse the attached vial or packaging photo(s) and extract the following fields as JSON. More than one photo may be attached (for example, the different sides of one vial, or a powder vial AND a separate diluent/water vial that ship together) — read them together as one product.

IMPORTANT: If the image shows a prescription, doctor's note, or handwritten instructions rather than a medication vial/bottle/package, return this instead:
{"document_type_mismatch": true, "detected_type": "prescription", "message": "This looks like a prescription rather than a vial or package label. Switch to 'Prescription' to extract the dosing instructions."}

Otherwise, return a JSON object with these fields, each as an object with "value" and "confidence" (high/medium/low):
- drug_name_raw: the exact name printed on the label
- drug_name_canonical: the standardised drug name (e.g. "testosterone cypionate", "chorionic gonadotropin")
- strength: the stated strength per unit or per volume (e.g. "200 mg/mL" for a liquid, "5000 IU" for a powder vial, or "10 mg" for a tablet/capsule)
- requires_reconstitution: "yes" if this is a lyophilized/freeze-dried POWDER (or a kit pairing a powder vial with a diluent/bacteriostatic-water vial) that must be mixed with a liquid before it can be injected; otherwise "no". Powders, "lyophilized", "for reconstitution", "reconstitute with", and a separate water/diluent vial are all signals of "yes".
- concentration_amount: for a ready-to-use LIQUID, the numeric concentration amount (e.g. 200). For a POWDER that needs reconstitution, the TOTAL active amount contained in the vial (e.g. 5000 for "5000 IU") — this is what dissolves into whatever volume of diluent is added. For a solid tablet or capsule, return null.
- concentration_unit: the unit of the amount above (e.g. "mg", "IU", "mcg")
- concentration_per_volume: the per-volume amount for a ready-to-use LIQUID only (e.g. 1 for "per mL"). For a POWDER that needs reconstitution, return null — the final volume is unknown until the user adds the diluent. For a solid tablet or capsule, return null.
- volume_ml: total liquid volume in mL for a ready-to-use liquid (e.g. 10). For a powder or a solid tablet/capsule, return null.
- diluent_type: if a diluent is named (on the powder label, or on an accompanying water vial), report it verbatim (e.g. "bacteriostatic water", "sterile water", "0.9% sodium chloride"). Empty string if none is shown.
- reconstitution_note: any printed mixing/reconstitution instructions, copied verbatim (e.g. "Reconstitute with 1 mL of accompanying diluent"). Empty string if none.
- route: the administration route (e.g. "intramuscular", "subcutaneous", "oral")
- directions: the dosing instructions printed on the label, copied verbatim if present. Empty string if the label shows none.
- expiry_date: expiry date if visible
- batch: batch or lot number if visible
- manufacturer: manufacturer name if visible

Do not guess the diluent volume to add — that comes from the patient's prescription, not the label.

Known medications this patient takes: {{known_medications}}
Preferred units: {{user_default_units}}

(see attached)

Return ONLY the JSON object, no other text.$body$,
    '["known_medications","user_default_units"]'::jsonb,
    'Detect powder/reconstitution: requires_reconstitution + diluent fields; powder reports total active amount with null per-volume.',
    null
  returning id
)
update public.prompts
  set current_version_id = (select id from ins)
  where slug = 'extract_vial';

-- ── extract_prescription: real body + reconstitution mix volume ─────────────
with p as (
  select id from public.prompts where slug = 'extract_prescription'
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
    $body$You are a prescription reader. Analyse the attached prescription photo, or the pasted prescription text below, and extract the following fields as JSON.

IMPORTANT: If this is actually a medication vial / package label (it shows a product's concentration and packaging but not a dose prescribed for a person), return this instead:
{"document_type_mismatch": true, "detected_type": "vial", "message": "This looks like a vial or package label rather than a prescription. Switch to 'Vial / package' to read the product details."}

Otherwise, return a JSON object with these fields, each as an object with "value" and "confidence" (high/medium/low):
- drug_name: the prescribed medication name
- dose_amount: the numeric amount taken each time (e.g. 500). Null if not stated.
- dose_unit: the unit of the dose (e.g. "mg", "IU", "mcg", "mL", "unit")
- frequency: how often it is taken, copied in plain words (e.g. "three times per week", "once daily")
- duration_days: the treatment duration in days if stated, else null
- route: the administration route (e.g. "intramuscular", "subcutaneous", "oral")
- prescriber: the prescriber's name if shown
- refills: the number of refills if stated, else null
- diluent_volume_ml: if the prescription tells the patient to RECONSTITUTE a powder, the volume of diluent to add, in mL (e.g. 3 for "reconstitute with 3 mL bacteriostatic water"). This is the only place that volume should come from. Null if the prescription does not mention reconstitution.
- diluent_type: the diluent named for reconstitution (e.g. "bacteriostatic water"), else empty string
- reconstitution_note: any reconstitution / mixing instruction, copied verbatim, else empty string

Known medications this patient takes: {{known_medications}}
Prescription text (if provided instead of a photo): {{prescription_text}}

Return ONLY the JSON object, no other text.$body$,
    '["known_medications","prescription_text"]'::jsonb,
    'Real prescription body (was placeholder); adds reconstitution mix volume/diluent.',
    null
  returning id
)
update public.prompts
  set current_version_id = (select id from ins)
  where slug = 'extract_prescription';
