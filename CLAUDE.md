# CLAUDE.md — Doozy Health

Operating guide for Claude Code on this project. Read this on every session, then read `PRD.md` end to end before answering questions about features, data model, or behaviour. The PRD is the source of truth for **what** to build; this file is **how** to build it and **what not to do**. If they disagree, stop and ask.

When implementing, cite the PRD section in your plan (e.g. "extraction review card per §5.2.1") so drift is easy to spot.

Doozy Health is a **wellness diary tool** for medication tracking — not a medical device, not medical advice. That is a regulatory position, not a tagline (see "Regulatory line" and PRD §6.1).

---

## Stack — non-negotiable without discussion

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 6.
- **Styling:** Tailwind v4. No CSS-in-JS. No component library beyond shadcn/ui if a real need appears.
- **Database:** Supabase (Postgres) + RLS. **Raw SQL migrations, forward-only. No Prisma, no ORM.** Use `@supabase/supabase-js`.
- **Auth:** Supabase Auth. **Magic link is the implemented baseline; WebAuthn is intended but not yet built** — don't treat it as done (PRD §6.2).
- **File storage:** Supabase Storage, private buckets, short-lived signed URLs only.
- **LLM gateway:** OpenRouter only, via `llmCall`.
- **PWA:** Installable to iOS/Android. Mobile-first for logging, desktop for review.

Don't introduce alternatives to any of the above without flagging it first.

---

## The hard rules

Never do these without explicit user approval in the chat. If you're about to, stop and ask.

1. **Never call an LLM provider SDK directly.** Every call goes through `llmCall` → OpenRouter. No exceptions, including scripts or tests.
2. **Never hardcode a model name** outside the admin backend. Models live in `prompt_bindings`.
3. **Never inline a prompt string.** Prompts live in `prompts` / `prompt_versions`, fetched by slug.
4. **Never store a secret in the runtime env.** `.env.local` holds only `SECRET_ENCRYPTION_KEY` and the bootstrap OpenRouter key needed to seed `system_secrets`. The running app reads keys from `system_secrets`.
5. **Never scope patient data with a single "current patient" helper.** Many-to-many via `patient_memberships`; RLS is membership-based; the active patient is session state (see "Scoping").
6. **Never auto-commit an extraction.** AI-derived data never writes without the user confirming on the review screen, regardless of confidence (PRD §5.2).
7. **Never advise, diagnose, or adjust a dose** (see "Regulatory line").
8. **Never compute pharmacokinetics with an LLM.** Curves, superposition, troughs — deterministic TypeScript. LLMs do only fuzzy work (extraction, normalisation, interaction *explanation*, diary suggestion, classification).
9. **Never let an LLM enumerate drug interactions.** The curated `drug_interactions` table is ground truth; `explain_interaction` only renders a record we already hold.
10. **Never put `patient_id` or `medication_id` in `extraction_deltas`** (see "ExtractionDelta").
11. **Never run destructive migrations** (`DROP`, `TRUNCATE`, deleting backfills) without showing them and getting an explicit "yes, run it."
12. **Never log health values** — medication names, dosages, dose times, photo contents. Scrub them everywhere.
13. **Name every npm dependency you add** — its purpose, weight, and the alternative considered. Dependencies are permitted where they earn their place (PRD §7); there is no blanket prohibition. (Planned: Twilio, Puppeteer, a charting lib, Web Push/VAPID; `motion` is already in for the calendar wheel.)
14. **Never gamify dose-taking** — no streaks, no badges, no "X days in a row", no surfaced adherence *score* or percentage, no guilt language on a missed dose, and no celebratory animation/confetti on a logged dose. A **factual adherence calendar is permitted**: it may colour-grade each day by what was actually logged versus scheduled (green = taken as chosen, graduated orange = partial, red = due-but-none-logged on a **past** day only) and use distinct per-medication identity colours. It is a neutral **record of what was logged**, not an instruction, target, or judgement — today is never shown as "missed", the future shows scheduled doses only, and no copy tells the user to dose. Anything beyond a factual record (rewards, streaks, habit mechanics) still crosses the regulatory line.

---

## Regulatory line

Wellness positioning is enforced through language, on every user-facing string and prompt body. The full rules and banned-verb list are in **PRD §6.1** — read them. The essentials:

- No "treat / diagnose / cure / prescribe" in user copy; "medical advice" only in the negation.
- The PK view is "illustrative / modelled," never "your actual level." We never say "dose now" or "this regimen is better."
- Interactions inform, never direct: "discuss with your doctor or pharmacist," never "do not take these together."
- Disclaimer footer on every screen and document (exact wording in §6.1).

If a request would cross this line, surface it and ask before building. Same discipline as Rize's "breath tool" vs "inhaler."

---

## Scoping (the biggest departure from the reference architecture)

The caregiver model makes patient ↔ user many-to-many, so there is **no single scope per user and no `current_*_id()` helper**. Full detail in **PRD §7**. The rule:

- Every patient-owned table has `patient_id`; RLS form: `patient_id IN (SELECT patient_id FROM patient_memberships WHERE user_id = auth.uid())`.
- The active patient is app session state, never a DB default.
- Storage keys are `<patient_id>/<doc_id>.<ext>`; the folder check runs against the membership set.
- `is_private` is enforced in the RLS predicate, not just the UI.
- **Write model (PRD §5.6):** owners **and** caregivers create `dose_logs` / `diary_entries` / `pk_calibrations`. **Only owners** edit regimens, change roles, invite/remove members, mark a medication private, or manage medications & inventory (e.g. syringes). `viewer` writes nothing. Enforce by role in RLS, not a blanket owner-only-write rule.

If you reach for a one-household-per-user pattern out of habit, stop — it silently breaks multi-patient access.

---

## LLM rules

The admin backend (PRD §14) holds all the LLM machinery — the most security-sensitive part of the codebase. Full `llmCall` contract in **PRD §14.6**; admin schema in §8. The gotchas that bite:

- Signature: `llmCall(promptSlug: string, vars: Record<string, string>, opts?): Promise<LlmCallResult>`. **`vars` are strings only.**
- **Images attach via `opts.images`** (base64 data URLs), never through `{{placeholders}}`. The body says "(see attached)."
- Result is a discriminated union returning **raw `text`** — the **caller parses and validates JSON defensively** (tolerate fences, take first `{`…`}`, validate enums). Never trust model JSON blindly, even with a schema bound.
- `/admin` is gated by `requireSystemAdmin()` → 404 (not 403) for non-admins. Regular users never see any reference to models, prompts, OpenRouter, or costs.
- `system_secrets` is app-layer encrypted (`lib/crypto.ts`, `SECRET_ENCRYPTION_KEY`) with **no client RLS** — server actions only. Store `value_encrypted` + `value_masked`; never return the raw value. **Documented exception:** `revealOpenRouterKey()` (`app/admin/settings/actions.ts`) returns the decrypted OpenRouter key to a system admin so an existing key can be reused on another machine — gated by `requireSystemAdmin()`, scoped to that one key, and every reveal is written to `admin_audit_log` (`view_source`). Do **not** generalise this to other secrets without the same gating + audit and an explicit owner sign-off.

New prompt: add a seed row (slug `^[a-z][a-z0-9_]*$`) — it may ship **enabled with a real body** or `disabled` with a placeholder; either way the body lives in `prompt_versions`, **never inlined in code** (rule #3) — plus a `prompt_bindings` row, call via `llmCall('slug', {...}, { images })`. Refine the body/binding in `/admin` after deploy. Never add a "quick path" that skips the service — add a prompt instead.

---

## ExtractionDelta

On every confirmation, write one `extraction_deltas` row per diverging field. Full spec in **PRD §5.2.3**. The invariant that matters here: **no `patient_id`, no `medication_id`** — keep `drug_canonical_name` for grouping and a `document_id` for source review, nothing that identifies the person. Admin "view source" renders the photo with identifying metadata redacted server-side and logs to `admin_audit_log`.

---

## Conventions

- **TypeScript everywhere.** No `.js` in the app (config excepted). `any` is a code smell; flag it when forced.
- **American English** in comments, UI copy, and prompt bodies (categorize, normalize, color). Pre-v0.6 code may still use British spellings (e.g. the `medications.colour` column, `lib/colours.ts`) — leave those as-is; write new code American.
- **App Router:** server components by default, `'use client'` only when needed, server actions for admin mutations, route handlers in `app/api/`.
- **Naming:** kebab-case files, PascalCase components, camelCase functions/vars, **snake_case DB columns** — `patient_id` not `patientId` in DB references.
- **Imports:** absolute from `@/`, never deep relative.
- **Errors:** typed, small error-class hierarchy; not `throw new Error("string")` for catchable cases.
- **Comments:** explain *why*, not *what*.
- **DB:** patient tables snake_case plural with the membership RLS predicate; admin tables global, gated by `is_current_system_admin()`. **Dose amounts and concentrations are `numeric`, never float.** `date` for calendar dates, `timestamptz` for instants. `created_at` on every table, `updated_at` + `set_updated_at()` trigger on mutable ones. Migrations forward-only — never edit an applied one.
- **UI:** mobile-first; calm, dense, monochrome with a single accent (ByZyB electric yellow `#F4EE35`). **Ships dark (default) + light themes** via the same semantic color tokens in `app/globals.css` (`--color-ink/paper/muted/faint/line/surface`, overridden under `:root[data-theme="light"]`); accent stays yellow in both and on-accent text uses `--color-on-accent` (never `text-ink`). Style with the tokens (`bg-ink`, `text-paper`, `border-line`, …) or `var(--color-*)` — **never hardcode hex or `bg-white`/`text-black`/`*-red-300`-type literals** in app code, or it won't adapt; status banners use `.alert-error` / `.alert-success`. No animations or confetti on a logged dose; tabular figures, right-aligned numbers; the syringe visual calibrated to the user's actual spec; the half-life view never alarmist (no red zones, no "dose now") — this no-red / non-directive rule governs the PK concentration chart, **not** the adherence calendar, where colour is a factual record of logged-vs-scheduled doses; staleness neutral ("last logged 4 days ago"); privacy-mode blur as global state; a patient switcher when a user has more than one patient.

---

## Testing

Test requirements are specified in **PRD §15**. The non-negotiables: no tests against live OpenRouter ever (mock at the `callOpenRouter` boundary); cover the `llmCall` fallback chain, the pharmacokinetic engine, the defensive extraction parser, the membership RLS predicate + `is_private` override, the `extraction_deltas` no-identifier invariant, and the "extraction is never auto-committed" integration path.

---

## When to stop and ask

Before: changing `PRD.md`; adding a dependency; changing the data model on existing tables; adding a route under `/admin`; touching encryption, RLS, or auth; talking to OpenRouter outside `llmCall`; writing user-facing copy that could read as advice or an instruction to dose; adding app-layer encryption to health data (net-new, not assumed); or building/reordering anything outside the §13 build sequence. Draft a plan, paste the relevant PRD section, wait for "go."

---

## Build sequence

Follow **PRD §13** step by step; don't jump ahead. Auth + the membership scoping foundation come first; manual entry before AI; the admin backend foundation before the first real LLM call; delta logging lands with the first extraction. Each step lands green (deploys, no broken tests) before the next. When a step is done, summarise what changed, link the PRD section, and ask whether to proceed.

---

*Keep this file short and opinionated. Detail belongs in the PRD; this file points to it.*
