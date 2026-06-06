-- Doozy Health — seed the extract_syringe prompt, shipped ENABLED with a real
-- body (the body lives here in prompt_versions, never inlined in code — rule #3).
-- American English. The image is attached at call time via opts.images, referred
-- to as "(see attached)". Refine wording later in /admin. Forward-only.
set search_path = public;

do $$
declare
  pid uuid := gen_random_uuid();
  vid uuid := gen_random_uuid();
begin
  set constraints all deferred;

  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (
      pid, 'extract_syringe', 'Extract syringe',
      'Read a syringe packaging photo into structured specifications.',
      'extraction', vid, 'active'
    );

  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (
      vid, pid, 1,
      'You read a photo of syringe packaging and return its specifications as JSON.

The image is provided separately (see attached). Common syringe types for reference: {{syringe_reference_types}}.

Return ONLY a JSON object — no prose, no code fences — with exactly these keys. Each value is an object {"value": <v>, "confidence": "high" | "medium" | "low"}. When a field is not legible, use null for the value with confidence "low". Never guess a value that is not visible.

{
  "capacity_ml": {"value": <number, capacity in mL, e.g. 1>, "confidence": "..."},
  "needle_gauge": {"value": <integer gauge, e.g. 29>, "confidence": "..."},
  "needle_length_in": {"value": <number, needle length in inches, e.g. 0.5>, "confidence": "..."},
  "unit_markings": {"value": <string describing the printed scale, e.g. "0.01 mL increments" or "insulin units">, "confidence": "..."},
  "manufacturer": {"value": <string>, "confidence": "..."},
  "batch": {"value": <string, lot or batch number>, "confidence": "..."}
}

Report capacity in mL. If a needle length is printed in millimeters, convert to inches (1 inch = 25.4 mm). Use American English.',
      '["syringe_reference_types"]'::jsonb,
      'Seed version (enabled with a real body).'
    );

  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');
end $$;
