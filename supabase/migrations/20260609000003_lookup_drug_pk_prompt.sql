-- Self-populating drug reference (PRD §5.7, §14): when a user adds a drug not yet
-- in the `drugs` table, look up its PUBLISHED POPULATION pharmacokinetic values
-- once and cache the row for everyone. This prompt is the lookup. Hard rule #8 is
-- respected — the LLM only LOOKS UP reference values (fuzzy lookup); the curve
-- math stays deterministic TS, and cached values are marked `llm_estimated` and
-- shown as illustrative. It NEVER computes a curve/dose or enumerates interactions
-- (#9). Seeded active with a real body. Forward-only.

do $$
declare
  pid uuid := gen_random_uuid();
  vid uuid := gen_random_uuid();
begin
  set constraints all deferred;

  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'lookup_drug_pk', 'Look up drug PK',
            'Look up published population pharmacokinetic reference values for a drug + route.',
            'classification', vid, 'active');

  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1,
$body$You are a pharmacology reference lookup. Given a drug name and an administration route, return PUBLISHED POPULATION pharmacokinetic reference values for that drug by that route, as JSON. These are textbook/population reference values — not advice, not personalised.

Do NOT compute any curve, dose, schedule, or recommendation. Do NOT invent numbers. If you do not have reliable published data for this drug by this route, return exactly {"unknown": true}.

Return ONLY a JSON object with these fields:
{
  "canonical_name": "<the standard generic name in lowercase, e.g. \"progesterone\">",
  "atc_class": "<ATC code if known, else empty string>",
  "controlled_schedule": "<e.g. \"CIII\" if a controlled substance, else empty string>",
  "is_linear": <true if it follows linear first-order kinetics; false for saturable / auto-inducing drugs (e.g. phenytoin, carbamazepine)>,
  "nonlinear_reason": "<short plain reason if is_linear is false, else empty string>",
  "half_life_hours": <terminal/elimination half-life in hours for THIS route, a positive number>,
  "half_life_range_hours": [<low>, <high>],
  "bioavailability": <fraction 0..1 for this route; omit if unknown>,
  "tmax_hours": <time to peak in hours for this route; omit if unknown>,
  "kernel": "<one of: exponential (instant IV / aqueous bolus), bateman (first-order absorption — most oral and IM depot), zeroOrder (transdermal patch or implant)>",
  "release_duration_hours": <for a patch/implant, the wear duration in hours; omit otherwise>
}

Drug name: {{drug_name}}
Route: {{route}}

Return ONLY the JSON object, no other text.$body$,
      '["drug_name","route"]'::jsonb,
      'Seed (active, real body): published PK reference lookup — fuzzy lookup only, no curve/dose.');

  insert into public.prompt_bindings
    (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug, response_format)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o', 'json');
end $$;
