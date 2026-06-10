-- Clinical narrative summary for the doctor report (PRD §5.10.1). Turns the
-- DETERMINISTIC facts our TypeScript already computed (adherence counts, dosing
-- gaps, diary trends, a shared weekly timeline) into a factual clinical hand-off
-- a doctor / coach / practitioner can read — observational prose, never advice.
-- The LLM does only fuzzy summarisation: it invents no numbers, computes no
-- curve or dose, and ranks no regimen (hard rules #7, #8; PRD §6.1). All
-- maths stays in TS; this prompt only narrates it. Seeded active with a real
-- body, JSON out (the caller parses defensively + post-filters banned verbs).
-- Forward-only.

do $$
declare
  pid uuid := gen_random_uuid();
  vid uuid := gen_random_uuid();
begin
  set constraints all deferred;

  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'summarize_report_for_clinician', 'Summarize report for clinician',
            'Turn pre-computed report facts into an observational clinical hand-off summary (no advice, no invented numbers).',
            'summary', vid, 'active');

  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1,
$body$You are writing a factual wellness-diary summary that a patient will hand to their doctor, coach, or other practitioner. You are NOT the clinician. Your job is to turn the supplied FACTS into clear, neutral prose that helps the reader understand what the person logged over this period — what they took, how consistently, what they tracked, and how their tracked measures moved alongside their medications.

You will be given a JSON object of pre-computed facts. EVERYTHING you write must come from those facts. This is a wellness record, not medical advice.

ABSOLUTE RULES — breaking any one makes the output unusable:
- Do NOT give advice, recommendations, or instructions. Never say what the person should do, should take, should change, or should ask for.
- Do NOT use the words treat, treatment, diagnose, diagnosis, cure, prevent, prescribe, recommend, advise, adjust, titrate, or any "should" / "must" / "need to" directed at dosing.
- Do NOT tell anyone to take, change, increase, decrease, stop, or start a dose. Never imply one regimen is better than another.
- Do NOT invent, estimate, or compute any number, dose, level, or date. Use only numbers present in the facts. If a number is not in the facts, describe it in words ("logged consistently", "a gap of several weeks") without making one up.
- Do NOT claim causation. Tracked measures that moved "around the same time as" a dosing pattern are an OBSERVED CO-OCCURRENCE the reader may wish to discuss with their clinician — never "X caused Y" or "X improved because of Y".
- Write in past tense, observational voice: "the user logged…", "doses were recorded…", "energy scores trended from 4 to 7…".

WHAT TO PRODUCE — return ONLY a JSON object, no other text, with exactly these fields:
{
  "overview": "<2–4 sentence plain summary of the whole period: who (age/sex if given), how many medications, the headline of how tracking went>",
  "medications": [
    { "name": "<medication name exactly as in facts>",
      "summary": "<2–4 sentences: the regimen in words, how consistent the logged dosing was, and any notable gap or missed run, stated factually from the adherence facts>" }
  ],
  "adherence_notes": "<1–3 sentences across all medications about overall consistency and any anomalies (a multi-week gap vs the occasional single miss). A neutral record of what was logged, not a score or judgement. Empty string if nothing notable.>",
  "diary_observations": "<a short paragraph summarising the tracked measures, grouped naturally into general measures, measures tied to a specific medication, and any labs/measurements (blood pressure, blood tests). Give the direction/range of each from the facts. Empty string if no diary data.>",
  "correlation_observations": "<a short paragraph noting where a tracked measure moved alongside a medication's dosing pattern over the same weeks, framed strictly as an observation to discuss with their clinician. Empty string if the data is too sparse to observe anything.>",
  "data_caveats": "<1–2 sentences naming real limits in the data: short period, few entries, sparse dosing history, etc. Empty string if none.>"
}

Reporting period: {{period_label}}

FACTS (JSON):
{{facts_json}}

Return ONLY the JSON object described above, no other text.$body$,
      '["period_label","facts_json"]'::jsonb,
      'Seed (active, real body): observational clinical hand-off summary from pre-computed facts — no advice, no invented numbers (PRD §5.10.1, §6.1).');

  insert into public.prompt_bindings
    (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug, temperature, max_tokens, response_format)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o', 0.30, 1600, 'json');
end $$;
