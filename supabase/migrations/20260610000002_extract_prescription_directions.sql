-- Refine the prescription reader (PRD §5.2): return the cadence ONLY in
-- `frequency` (so the review screen can build a real schedule), the full
-- instruction verbatim in a new `directions` field, and name the eye/ear/nose
-- routes added in 20260610000001. Forward-only: adds a new prompt_versions row
-- and points the prompt at it; the prior version is kept.

do $$
declare
  pid uuid;
  vid uuid := gen_random_uuid();
  nextver int;
begin
  select id into pid from public.prompts where slug = 'extract_prescription';
  if pid is null then
    raise notice 'extract_prescription prompt not found; skipping';
    return;
  end if;
  select coalesce(max(version_number), 0) + 1 into nextver
    from public.prompt_versions where prompt_id = pid;

  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, nextver,
$body$You are a prescription reader. Analyse the attached prescription photo, or the pasted prescription text below, and extract the following fields as JSON.

IMPORTANT: If this is actually a medication vial / package label (it shows a product's concentration and packaging but not a dose prescribed for a person), return this instead:
{"document_type_mismatch": true, "detected_type": "vial", "message": "This looks like a vial or package label rather than a prescription. Switch to 'Vial / package' to read the product details."}

Otherwise, return a JSON object with these fields, each as an object with "value" and "confidence" (high/medium/low) UNLESS noted otherwise:
- drug_name: the prescribed medication name
- dose_amount: the numeric amount taken each time (e.g. 500). Null if not stated.
- dose_unit: the unit of the dose (e.g. "mg", "IU", "mcg", "mL", "unit")
- frequency: the CADENCE ONLY, in short structured words — one of this style: "once daily", "twice a day", "three times a day", "every 8 hours", "every other day", "once a week", "three times per week", "once a month", or "as needed". Do NOT include the time of day, the body site, or the amount here — just how often. If the cadence is not stated, use an empty string.
- directions: the FULL dosing instruction copied EXACTLY as written, verbatim, including time of day and site (e.g. "one drop in both eyes once per day before bed", "take 1 tablet by mouth every morning"). Empty string if none is printed.
- duration_days: the treatment duration in days if stated, else null
- route: the administration route. Use one of: "oral", "sublingual", "intramuscular", "subcutaneous", "transdermal", "suppository", "topical", "inhaled", "ophthalmic" (eye drops), "otic" (ear drops), "nasal" (nasal spray/drops). Pick the closest; for eye drops use "ophthalmic".
- prescriber: the prescriber's name if shown
- refills: the number of refills if stated, else null
- diluent_volume_ml: if the prescription tells the patient to RECONSTITUTE a powder, the volume of diluent to add, in mL (e.g. 3). This is the only place that volume should come from. Null if not mentioned.
- diluent_type: the diluent named for reconstitution (e.g. "bacteriostatic water"), else empty string
- reconstitution_note: any reconstitution / mixing instruction, copied verbatim, else empty string
- required_components: an ARRAY (not the value/confidence shape) naming supplies this medication needs that the prescription may NOT spell out — inferred from the drug and its form using general knowledge. A lyophilized powder (e.g. hCG, many peptides) needs a diluent and a syringe even if the script just gives a dose; an injectable needs a syringe; an inhaler is often used with a spacer (and a face mask for a young child); an oral suspension needs an oral syringe or dropper. Each item: {"type": one of [reconstitution, syringe, diluent, spacer, face_mask, oral_syringe, dropper, pen_needle, nebulizer, applicator, swab, sharps_bin], "inferred": true if you inferred it from drug knowledge rather than reading it on the prescription, "confidence": "high"|"medium"|"low"}. Only components genuinely relevant; empty array [] if none. Do NOT advise buying anything — only name what this medication needs.

Known medications this patient takes: {{known_medications}}
Prescription text (if provided instead of a photo): {{prescription_text}}

Return ONLY the JSON object, no other text.$body$,
      '["known_medications","prescription_text"]'::jsonb,
      'Cadence-only frequency + verbatim directions field; names eye/ear/nose routes.');

  update public.prompts set current_version_id = vid where id = pid;
end $$;
