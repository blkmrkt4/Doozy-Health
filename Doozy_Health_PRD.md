# Doozy Health — Product Requirements Document

**A wellness diary tool for personal medication tracking and how you feel.**

| Field | Value |
|---|---|
| Author | Robin David Hutchinson |
| Version | 0.6 (Draft — American English; standalone build basis; corrected permission and dependency rules) |
| Date | 5 June 2026 |
| Status | For review — pre-engineering |
| Target platform | Responsive web app (PWA) — desktop, iOS Safari, Android |
| Regulatory positioning | Wellness / general-purpose — not a medical device, not medical advice |

## Changelog

| Version | Changes |
|---|---|
| **v0.6** | **All references to any prior/borrowed codebase removed** — the document now stands on its own as the Doozy build basis; design decisions are stated directly rather than as departures from or matches to another project. **Language switched from British to American English** throughout (prose, UI copy, prompt bodies, and the `normalize_drug_name` slug → `normalize_drug_name`). **"Owner-only writes" eliminated:** §5.6 now states the write model explicitly — owners *and* caregivers can create dose logs and diary entries; only owners change roles, mark medications private, edit regimens, or remove members. **"No new npm dependency" prohibition removed:** §7 now states that new dependencies are permitted where they earn their place and must simply be named with weight and alternative (Twilio, Puppeteer, a charting library, and Web Push/VAPID remain the planned set). |


## 1. Executive summary

Doozy Health is a wellness diary tool for tracking medications and the things that surround them — how the user feels, sleeps, performs. The core insight is that most medication tracking apps fail because they conflate three different things that the user experiences as distinct: **what was prescribed**, **what the user actually has in their hand** (a vial at a concentration the pharmacy happened to stock, a patch sold at a strength that doesn't match the prescription without cutting, a pill bottle that's substituted one ester of testosterone for another with a different half-life), and **how the user has chosen to take it** (a once-weekly injection split into three smaller weekly shots to flatten the curve, a transdermal dose split across two patch placements, a tapered opioid regimen that's stepping down faster than the prescription dictates).

Doozy keeps these three layers distinct from the schema up. The primary input is a photo — of the vial, the prescription, the patch box, the pill bottle, the syringe, a written set of instructions — and the system extracts the structured data, surfaces it for confirmation alongside the source image, and then makes logging a single tap. Manual entry is fully supported as an alternative: a user who knows their medication can enter the fields directly, and is then offered the option to attach a photo afterwards for verification (encouraged, never required). In either direction, every divergence between what the LLM extracted and what the user confirmed is recorded as an `ExtractionDelta` — these feed an admin view of extraction quality (§14.7) that surfaces which fields, which drugs, and which models produce the most corrections, so prompts and model bindings improve over time. Around that, a deterministic pharmacokinetic view shows the user where they are in their dosing curve, a curated drug-interaction database (with LLM-rendered plain-language explanations) flags overlaps, and a Notion-style customizable diary lets the user track only the things they care about — sleep hours, mood, energy, side effects, weight gain, weight loss, irratability, racing heart, fatigue, concentration, jumpiness, pain, fever, dry mouth, dry gentials (female), sore breasts, achy joints, poor cold or heat tolerance, night sweats, acid indigestion, swelling, tendinitis, muscular soreness. 

The product is explicitly positioned as a **wellness / general-purpose tool**. It is not a medical device. It does not provide medical advice, but it does provide very valuable diagnositc information - charts, warnings, knowledge of of pharmacokinetics. It does not treat, diagnose, prescribe, or cure. Its output is a defensible record the user takes to their own clinician, but also is informative daily to the user or a subscribed care-giver on what was taken and when, when doses were missed, when medication might be running out in advance so that if a prescription needs to be refreshed it can be done in advance. That positioning is codified in the language rules of §6.1, which are not optional and not stylistic — they are the line between this product and a regulated medical device.

Built for one user initially, but the data model is multi-party from day one to support caregivers (a parent tracking a child's ADHD medication; an adult child overseeing an elderly parent's prescriptions; a partner tracking a partner's HRT) and a doctor read-only view.

---

## 2. Goals and non-goals

### 2.1 Goals

- Reduce the time to log a scheduled dose to under 10 seconds: open app → tap medication card → confirm → done.
- Distinguish, at the schema layer, between **prescribed regimen**, **delivery form**, and **chosen regimen** — and surface all three in the UI as distinct, editable objects.
- Provide a deterministic, illustrative pharmacokinetic view — "based on textbook half-life, here is roughly where you are".
- Treat photo capture and manual entry as **equal first-class paths** into the medication record, with optional photo verification on the manual path.
- Capture every divergence between LLM extraction and user truth as an `ExtractionDelta`, so the admin team can see — per field, per drug, per prompt version, per model — where extractions are diverging and improve the system.
- Support multi-party access (caregivers) from day one via a Patient / PatientMembership data model.
- Generate a clean, branded PDF export the user can take to their doctor.
- Work equally well as a one-handed phone interaction (logging) and a desktop review (analysis, configuration, exports).
- Keep all health data private, encrypted, and under the user's sole control.

### 2.2 Non-goals (v1)

- Medical advice, dose recommendations, treatment suggestions, or symptom checking. The product diaries; the doctor advises. **Note on the v0.4 additions:** the personal-calibration and regimen-explorer features (§5.7, §4.8, §4.9) deliberately stay inside this non-goal. Calibration fits a curve to readings *the user enters*; the explorer renders curves for scenarios *the user constructs*. Neither computes, suggests, ranks, or highlights a dose or a regimen. The boundary is the information-vs-instruction line in §6.1: we present information the user interprets; we never make the dosing decision.
- E-prescribing, prescription renewal, or pharmacy connections.
- EHR / EMR integration (HL7, FHIR).
- Telehealth, clinician messaging, or asynchronous care.
- Pill identification from a loose pill or a partial photo.
- Wearable integration (Apple Health, Whoop, Oura, Eight Sleep). Diary fields are manual input in v1; integration is a v2 consideration.
- Adherence **scoring** as a surfaced metric (a numeric grade or percentage), or any gamification of dose-taking (streaks, badges, rewards, no guilt oriented prompts). *(A factual adherence calendar that color-grades days by what was logged is permitted — see §6.1 and §9 — because it is a record, not a score or a habit mechanic.)*
- Insurance, pricing, or refill orchestration. *(A factual set of calculations to at the specified dose and with knowledge of the total volume, number of pills, number of patches etc, if a new prescription/inventory is needed, it would be needed on X date is permitted)*
- Mental health crisis features (this is a separate product category with a much higher regulatory bar and a different design discipline).
- Native iOS / Android apps. PWA only in v1.
- Domestic Thai market - only v1 territories are US, Canada, UK, Australia, Western Europe.

---

## 3. Target user

**Primary user:** called "User" -an adult managing one or more long-term medications — testosterone or oestrogen replacement, ADHD treatment, antidepressants or anxiolytics, post-surgical regimens, chronic conditions (diabetes, hypothyroidism, hypertension, autoimmune therapies). They are comfortable with technology, want a defensible record to bring to their doctor, and have run into the friction of standard clinical guidance lagging their lived experience — testosterone protocols that assume weekly injections when split-dosing is materially better tolerated; oestrogen patches at strengths that don't match the prescription without cutting; opioid tapers that require precise tracking to work; HRT pharmacists substituting esters with different half-lives because of stock.

**Secondary user:** called "Supporter" - a family caregiver tracking a parent's, partner's, or child's medication. They need to see the schedule, log doses on behalf of the tracked person (or be notified that the tracked person hasn't logged), and produce a clean record at appointment time.

**Tertiary user :** called "Clinician Reader" - a clinician with read-only access via a link the patient generates, for the appointment itself or for asynchronous review. A naturopath, or a personal trainer or coach is also included.

The user is **not** someone looking for symptom-checking, a "should I take this now?" oracle, or a substitute for their doctor. The product attracts users who already know what they take and want it logged accurately.

---

## 4. Core user journeys

### 4.1 First-time medication setup (photo-driven)

1. User taps "Add medication" on the home screen.
2. Camera prompt — take a photo of the vial, patch box, pill bottle, printed prescription, written advice, syringe package, bacteriostatic water. Multi-photo (front + back of a bottle, multi-page prescription) is supported as a batch.
3. App uploads and shows a "reading…" indicator (target < 5 seconds for a typical photo).
4. App returns an extraction review card: drug name (canonical and raw), strength, concentration where applicable, volume or pack count, route, expiry, batch, manufacturer. Each field shows a confidence indicator. The original photo thumbnail is displayed alongside the extracted fields so the user can cross-check at a glance. Tapping the thumbnail opens the full image.
5. User edits any field inline, then confirms. Any field the user changed from the LLM's extracted value is recorded as an `ExtractionDelta` (direction `llm_to_user`); see §5.2.3.
6. App proposes a **delivery form** based on the extraction (e.g. "10 mL vial of testosterone cypionate, 200 mg/mL, IM"). User confirms or edits.
7. **Prescribed regimen** — user enters, or a prescription photo extracts: e.g. "200 mg per week, IM, prescribed by Dr Singh, 6 months". User confirms.
8. **Chosen regimen** — defaults to the prescribed regimen but the user can override. If the user picks a different cadence (e.g. "split into three weekly injections"), the app shows the implied per-dose amount and per-dose volume (e.g. "≈67 mg per dose; ≈0.33 mL on your 1 mL insulin syringe — fill to the third major line"). The chosen regimen is what the reminder schedule and the PK chart run from.
9. Reminder schedule generated from the chosen regimen. User reviews timing, confirms.
10. Medication card added to the home screen.

### 4.2 First-time medication setup (manual)

A first-class path with full parity to the photo flow. For users who know their medication, who don't have a photo to hand, or who prefer to enter by hand (a compounded cream from a specialist pharmacy, an estimated supplement dose, a medication the user already knows by heart).

1. User taps "Add manually" from the home screen.
2. User picks a route (oral, sublingual, IM, sub-q, transdermal, suppository, topical, inhaled), then searches the reference drug database for the drug.
3. Same three-layer setup as 4.1, but each layer is entered manually.
4. On confirmation, the app offers an **optional verification photo**: *"Want to add a photo of the vial or prescription for your records? We'll also check the photo against what you entered."* The user can skip, or attach a photo. If a photo is attached, the same extraction pipeline runs against it; any divergence between the photo extraction and the user's entered values is surfaced for resolution (keep entry, accept photo, or edit further), and the resulting `ExtractionDelta` records are tagged with direction `user_to_llm`. See §5.2.2 and §5.2.3.
5. Manually entered medications are flagged in the medication history so the user can distinguish them from photo-derived ones during review.

### 4.3 Log a dose

1. User taps the medication card on the home screen.
2. Default action: "Took the scheduled dose just now" — single tap → logged. Done.
3. Alternative actions: "Different amount", "different time", or "skipped" — expand to a detail form with custom amount, custom time, optional note, reason for skip.
4. **For injections:** a syringe-shaped visual rendered against the user's actual syringe spec (capacity, gauge, needle length, unit markings — entered during medication setup) showing the chosen dose volume against the syringe's actual markings. The user confirms by tapping. The visual is calibrated, not decorative.
5. **For patches:** log application time, body placement (with optional rotation reminder for the next application), and an expected removal time.
6. **For oral / sublingual:** confirm the dose count taken.
7. Optimiztic UI — the log is committed locally first, then synced. Single-tap path feels instant.

### 4.4 View dosing timeline (half-life view)

1. User taps a medication.
2. A line chart shows the **modeled** concentration over the past 14 days plus the projected next 7, built by superposing every logged dose through the drug's per-route kernel (§5.7). The curve runs from the **chosen regimen**.
3. A shaded **uncertainty band** surrounds the line, reflecting the population half-life *range* for the drug — a visual statement of "your body may vary", not a target zone.
4. Annotations: each logged dose marker, the **projected trough** (a quiet timeline marker — never an alert, never a countdown), and a "you are here" line.
5. **Missed-dose shape:** where the log has a gap, the dip is rendered illustratively so the user can see the consequence of what happened. The chart shows the shape; it never shows a corrective amount.
6. **Chosen-vs-prescribed overlay:** for drugs where the chosen regimen materially differs from the prescribed one (e.g. testosterone split-dosing), the user can overlay both curves and see why their chosen pattern produces a flatter curve. The overlay is illustrative; we never tell the user one regimen is "better".
7. **New-medication context:** for a newly added drug, the view can show an illustrative "time to a stable level, based on textbook half-life" marker, explaining why effects lag the first dose. General education, not advice.
8. The chart carries a permanent inline disclaimer: *"Based on textbook half-life. Your body may vary. Not medical advice."* For a calibrated curve (§4.8), the disclaimer reads: *"Your personal estimate, based on the readings you entered. Illustrative, not a measurement. Not medical advice."*
9. **No** red zones, **no** warning coloring, **no** "you should dose now" prompts anywhere **in this concentration chart**. The chart shows; the user decides. *(This governs the PK chart; the separate adherence calendar may use status color as a factual record — see §6.1, §9.)*

### 4.5 Add a caregiver

1. From the patient owner's settings → Caregivers → Invite.
2. Email or phone number entry.
3. Choose role: **caregiver** (log + receive reminders + view all non-private medications) or **viewer** (read-only).
4. Invite is sent. The recipient creates an account or accepts on an existing one.
5. Caregiver now sees the patient in their patient list (with a clear top-bar indicator of whose data is on screen), and can log doses and receive reminders for that patient.
6. Owner can mark specific medications as **private** at any time — these are excluded from caregiver and viewer visibility regardless of role.

### 4.6 Set up reminders

- Per-medication reminder schedule, generated from the chosen regimen.
- Delivery: Web Push to PWA users (the user's installed app); SMS via Twilio as a fallback for caregivers who haven't installed the app.
- Notification actions: "Taken", "Snooze 15 min", "Skip".
- Escalation chain (optional, per medication): if a dose isn't logged within X minutes of the scheduled time, notify the designated caregiver.
- Smart consolidation: if multiple medications are due within a 30-minute window, send one notification covering all of them rather than several.

### 4.7 Export for doctor visit

1. Settings → Export → choose date range, medications, diary fields to include.
2. PDF generated server-side.
3. Contents: medication list with the three-layer regimen for each, dose log with timestamps, diary entries (any custom fields the user has been tracking), pharmacokinetic chart snapshot per medication, and original vial / prescription photos as an appendix.
4. Branded: ByZyB.ai palette but with a white background. Disclaimer footer on every page.
5. Download, prind or send to the clinician's email (with the patient's explicit consent at send time).

### 4.8 Calibrate the curve to your own readings (opt-in)

A user who has their own observed readings (e.g. trough blood results their clinician ordered) can optionally calibrate the modeled curve to fit them better. Off by default; the user opts in per medication.

1. From the timeline view → "Calibrate to my readings" (opt-in, with a one-time explainer of what calibration is and what it is **not**).
2. User enters one or more readings, or uploads a picture/takes a photo of their blood results which is extracted by an LLM: value, unit, date/time, optional note. Stored in `pk_calibrations`, patient-scoped, and treatable as **private** (§5.6, §6.2).
3. With two or more valid readings taken during a decline (no intervening dose between them, or a steady-state trough-to-trough pair), the engine back-solves a **personal terminal half-life** (§5.7) and re-runs the curve. Absorption (Tmax) is **not** fitted from sparse readings — only the terminal half-life is adjusted, within physiologically plausible bounds; implausible fits are rejected and the textbook curve is retained.
4. The calibrated curve is always shown **alongside** the textbook curve so the user sees the difference, and is clearly tagged "your personal estimate".
5. Calibration changes only what the curve looks like. It never produces, suggests, or implies a dose. The "no recommendation" posture (§6.1) is unchanged.

### 4.9 Explore a regimen (user-driven, no recommendation)

A sandbox for the sophisticated user (typically HRT / split-dosing) to *see the shape* of a schedule they're considering — like a calculator, not an adviser.

1. From the timeline view → "Explore a regimen".
2. User constructs a hypothetical chosen regimen: per-dose amount, cadence, route. All inputs are the user's.
3. The engine renders the resulting curve, and optionally overlays it on the user's current chosen regimen for comparison.
4. The view presents **only** the curve shapes. It does not rank them, label one "smoother" or "better", highlight an "optimum", or suggest the user adopt any scenario. Per §6.1, the product never judges one regimen against another.
5. Nothing in the explorer writes to the user's actual chosen regimen. Adopting a scenario is a separate, deliberate edit the user makes in medication settings.

---

## 5. Functional requirements

### 5.1 Document and photo capture

- Input methods: native camera capture (via the standard HTML `capture` attribute or `getUserMedia`), file picker for PDF and image formats (HEIC, JPEG, PNG).
- Multi-photo support for front + back of a bottle, multi-page prescriptions, or batched pill packaging.
- Each photo / document is stored encrypted at rest in a private Supabase Storage bucket. Object keys follow the convention `<scope_id>/<doc_id>.<ext>`; here the scope is the patient (see the storage-RLS caveat in §7). A `documents` row links the file to the resulting medication, delivery form, or prescription, with a 25 MB cap enforced at both the bucket and the row.
- Photos can be attached at two points in the lifecycle: at medication creation (photo-first path, §4.1), or after manual entry as a verification step (manual-first path, §4.2).
- The user can re-open the original photo from any historical dose log that referenced it, via a short-lived signed URL.

### 5.2 AI extraction and verification

Extraction is performed by vision-capable LLM calls routed through the `llmCall` service (see §14.6). The image is attached through the call's `opts.images` parameter (a base64 data URL), **not** substituted into the prompt body as a `{{placeholder}}`; the prompt body refers to it as "(see attached)". The model returns JSON, which the extraction service parses defensively (tolerates ```json fences, extracts the first `{`…`}`, validates against allowlists) rather than trusting blindly even when a JSON schema is bound. The verification UI is non-negotiable, even on high-confidence extractions.

#### 5.2.1 Photo-first path

- Every extracted field is displayed in an editable form: drug name (canonical and raw), strength, concentration, volume or pack count, route, expiry, batch, manufacturer, prescriber (for prescriptions).
- Each field shows a confidence indicator (high / medium / low), returned per-field in the extraction JSON. Low-confidence fields are visually highlighted and require explicit user touch to confirm.
- A thumbnail of the source photo is shown adjacent to the fields. Tapping opens the full image.
- The extraction populates `documents.extracted_json` and moves `documents.status` through `uploaded → processing → extracted`. Nothing writes to the medication record until the user explicitly confirms.

#### 5.2.2 Manual-first path with optional photo verification

- When the user enters medication details manually (§4.2), they are offered the option to attach a photo afterwards for verification — encouraged, never required.
- If a photo is attached, the same extraction pipeline runs and the extracted fields are compared field-by-field to what the user entered.
- When the photo extraction differs from user input, the user is shown the divergence and can either keep their original input, accept the photo extraction, or edit further. The user's final confirmed value is what the medication record stores.

#### 5.2.3 Delta capture (admin signal for system improvement)

Every divergence between an LLM extraction and a user-confirmed value is recorded as an `ExtractionDelta` row in a system-level table (see §8 and §14.7). The delta records, per field:

- The LLM-extracted value and the user-confirmed value.
- The direction: `llm_to_user` (the user corrected the LLM's extraction on the photo-first path) or `user_to_llm` (the verification photo differed from the user's manual entry on the manual-first path).
- The prompt slug and `prompt_version_id` that produced the LLM output, the model that ran (`model_used`), and the LLM's reported confidence for that field.
- A reference to the source `documents` row (for deliberate admin photo inspection during review).

`ExtractionDelta` deliberately does **not** reference a patient or medication. The table answers "what is the system getting wrong" without exposing which patient was affected. Source-photo viewing from the admin Extractions page (§14.7) is a deliberate, rate-limited, audit-logged action; patient-identifying metadata on the rendered photo (name, address on a prescription) is redacted by a server-side pre-render pass before the admin sees the image.

A separate **per-user correction signal** is also maintained, distinct from the system-wide delta capture: when a user repeatedly edits the same field on documents from the same drug, prescriber, or pharmacy, a per-user mapping table grows and improves that user's future extractions on those documents. This signal is patient-scoped and does not flow into the system-wide `ExtractionDelta` table.

### 5.3 The three-layer regimen model

The schema enforces three distinct objects per medication. This is the most important domain decision in the product.

| Layer | What it represents | Source |
|---|---|---|
| **PrescribedRegimen** | What the doctor wrote on the prescription: drug, dose, frequency, duration, route. | Prescription photo or manual entry. Immutable once a prescription is recorded — a new prescription creates a new record, never overwrites. |
| **DeliveryForm** | The physical thing the user has in hand: vial concentration, patch strength, pill bottle dose-per-tablet, the syringe size and gauge they bought. | Vial / patch / bottle photo or manual entry. Replaced when the user gets a new fill at a different concentration. |
| **ChosenRegimen** | How the user has decided to take it: cadence, per-dose amount, optional reason note. Drives the reminder schedule and the PK chart. | User selection, defaults to PrescribedRegimen on creation. Editable at any time. |

When the user changes the chosen regimen, the reminder schedule regenerates and the PK chart recomputes. The prescribed regimen and delivery form are unaffected. The doctor's PDF shows all three side by side.

### 5.4 Dose logging

- Default path: one-tap log of the scheduled dose at the current time.
- Alternative paths: custom amount, custom time (past or future), skipped with reason, "as-needed" / PRN log.
- Injection logs prompt for syringe-marking confirmation (the calibrated syringe visual) and optionally injection site.
- Patch logs prompt for placement and an expected removal time.
- Each `dose_logs` row stores: medication, scheduled time (nullable for PRN), actual logged time, amount in native units (`numeric`, never float), route taken, site (nullable), note (nullable), `source` (manual / reminder_action / caregiver), `logged_by_user_id`.

### 5.5 Reminders engine

- Schedule generator: from the active chosen regimen, materialize the next N days of `dose_reminders` rows.
- Delivery channels: Web Push API for PWA users; Twilio SMS for caregivers without the app installed.
- Notification action handlers: "Taken" → creates a `dose_logs` row with `source = reminder_action`; "Snooze" → reschedules; "Skip" → records as skipped.
- Escalation: per-medication, configurable. If a dose isn't logged within X minutes of due, notify the designated caregiver.
- Smart consolidation: medications due within a configurable window (default 30 min) collapse to a single notification.
- Caregiver-only subscription: a caregiver can subscribe to reminder delivery without being the primary logger.

### 5.6 Patient and caregiver model

- A `users` row can be a member of multiple `patients`.
- A `patients` row can have multiple `users` members.
- Roles per `patient_memberships`: `owner`, `caregiver`, `viewer`.
- `owner` can invite, modify roles, remove members, and mark medications as private.
- `caregiver` can log doses, receive reminders, and view all non-private medications.
- `viewer` (typically a clinician via a generated link) has read-only access for a configurable duration; the link is signed and expires.
- **Write model (no owner-only-writes restriction).** Owners *and* caregivers can create `dose_logs`, `diary_entries`, and `pk_calibrations` for the patient — logging is a shared caregiving action, not an owner privilege. Only the **owner** can change roles, invite or remove members, mark a medication private, or edit a regimen. `viewer` writes nothing. RLS enforces this by role, not by a blanket owner-only-write rule.
- All Row-Level Security policies are bound to `patient_memberships`, not a single scope id — see §7 for the scoping model.
- Private medications: a per-medication `is_private` flag overrides default caregiver/viewer visibility. Necessary for mental health, controlled substances, and any sensitivity. Default is non-private; the owner explicitly flips the flag.

### 5.7 Pharmacokinetic visualization

**Governing principle.** This view presents information about what the user has logged and what textbook pharmacology says in general. It never recommends, computes, or displays a dose to take, and it never judges one regimen against another. Every output is something the user interprets and can discuss with their clinician (§6.1).

**Deterministic, never LLM.** All curve maths is deterministic backend code. No language model is in this path. This is the most correctness-sensitive code in the product (§15).

**Architecture — superposition + kernel library + linearity gate.** The engine is three independent pieces:

- **Superposition engine.** Under linear pharmacokinetics, the modeled level at any time is the sum of the independently-evolving contributions of every prior dose: `level(t) = Σ kernel(dose_i, t − t_i, params)` over doses with `t_i ≤ t`. Drug-agnostic; never changes.
- **Kernel library.** The single-dose contribution shape, selected **by route** from the drug's parameters. Three kernels in v1: `exponential` (IV-like / robust decline approximation), `bateman` (first-order absorption + elimination, for oral and depot esters; its absorption constant is derived from the stored **Tmax**, not guessed), and `zeroOrder` (constant-rate release then elimination, for transdermal patches and implants). Adding a drug shape is a kernel addition plus reference data; the engine and UI do not change.
- **Linearity gate.** A per-drug boolean (`is_linear`, §8). Superposition is valid only under linear kinetics. Drugs flagged non-linear (saturable elimination, e.g. phenytoin; auto-induction, e.g. carbamazepine) get **no curve and no trough projection** — instead an honest panel: "This medication doesn't follow simple curve maths, so a modeled level would mislead. Track your doses and talk to your clinician." Refusing to draw what we can't draw honestly is the conservative, correct posture — it strengthens §6.1, it does not strain it.

**Reference `drugs` parameters (per route).** The engine reads, per route, from the `drugs` table (§8): kernel type (`kernel_by_route`); half-life (`half_life_hours`); **half-life range** (`half_life_range_hours`, low/high, for the uncertainty band); Tmax (`tmax_hours`); bioavailability; release duration (`release_duration_hours`, zero-order only); and any **secondary metabolites** (`metabolites`) with their own kernel, fraction, half-life and Tmax. Reference times are stored in **hours**; the engine works in a consistent unit internally.

**Active metabolites.** Where a drug carries metabolite parameters (the schema already anticipates this), the engine models parent and metabolite as separate compartments and can render either or both. A parent-plus-metabolite curve is more complete and more honest than a single line; it is still illustrative.

**What the chart shows.** Past 14 days + projected next 7, run from the chosen regimen: logged-dose markers; a "you are here" line; the projected trough as a quiet marker (never an alert or countdown); the **uncertainty band** (population half-life range — a "your body may vary" visual, never a therapeutic target); the **missed-dose shape** where the log has gaps (consequence of logged history, never a corrective amount); the **chosen-vs-prescribed overlay** (illustrative, never "better"); and, for new medications, an illustrative **time-to-steady-state** marker (general education).

**Personal calibration (opt-in — see §4.8).** With ≥2 valid user-entered readings, the engine back-solves a personal terminal half-life: for two decline-phase readings, `k = ln(C₁/C₂) / (t₂ − t₁)`, `halfLife = ln(2)/k`, constrained to physiologically plausible bounds; implausible fits are rejected. Only the terminal half-life is fitted (absorption / Tmax stays from the reference). The calibrated curve is shown alongside the textbook curve, tagged "your personal estimate", and never described as a measurement. Calibration changes the picture, never the advice posture — it produces no dose.

**Regimen explorer (user-driven — see §4.9).** Renders curve shapes for a schedule the user constructs. No ranking, no "optimum", no recommendation, no write-back to the live regimen.

**Prohibited in this view (reaffirmed).** No red zones, no warning coloring, no "you should dose now" prompt, no corrective or catch-up dose amount, no "this regimen is better" judgment, and no automatic adjustment of any regimen based on our maths. *(These prohibitions are specific to this PK view; they do not constrain the adherence calendar's factual status coloring — §6.1, §9.)* The chart shows; the user decides.

### 5.8 Drug interaction checking

- **Curated source as ground truth.** v1 sources: RxNorm + openFDA + DDInter. Commercial feed (First Databank or similar) considered for v2.
- Local `drugs` and `drug_interactions` tables, synced daily from the curated sources.
- On medication add: pairwise check against every other active medication on the patient.
- Display: severity (info / caution / serious), mechanism (short technical summary from the source), and a plain-language explanation rendered by `llmCall('explain_interaction', {...})`.
- **The LLM does not enumerate interactions.** It only renders curated records into readable English. This is the most consequential epistemic decision in the product and is non-negotiable.
- For "serious" severity, a more prominent banner appears on the medication card, but the framing is never directive: "These are known to interact — discuss with your doctor or pharmacist." We do not say "do not take these together".
- Free-text "other medications" field: visible in the doctor PDF for completeness, but **not** interaction-checked — we don't claim coverage we don't have. Labeled clearly as "outside the interaction check".

### 5.9 Diary / custom tracking fields

- Per-patient field configuration, Notion-style.
- Field types: number (e.g. hours of sleep), 1–10 scale (e.g. mood, pain), boolean (e.g. nausea today), free text (e.g. side-effect notes), single-select category (e.g. headache type).
- No imposed defaults. During onboarding, the app **suggests** fields based on the user's medications (e.g. testosterone → mood, energy, libido; SSRI → mood, sleep, sexual side effects; opioid → pain, constipation, drowsiness) via `llmCall('suggest_diary_fields', {...})`. The user picks what they want; nothing is auto-enabled.
- Entry mode: either as a standalone `diary_entries` row (free-floating in time) or attached to a `dose_logs` row (e.g. "logged a dose + felt nauseous").
- Diary fields appear in the doctor PDF in their own section.
- v2: integration with Apple Health, Whoop, Oura, Eight Sleep to populate selected fields automatically. v1 is manual.

### 5.10 PDF export for doctor consultation

- Server-side render (Puppeteer in a serverless function, against a styled React component). Puppeteer is a net-new dependency (§7).
- Configurable: date range, medications included, diary fields included, log granularity (every dose vs daily summary).
- Contents:
  - Cover page: patient name, date range, generated date, disclaimer footer.
  - Medication list: each with all three regimen layers and current status.
  - Dose log table: chronological, per medication.
  - Diary entries: chronological, with field values.
  - Pharmacokinetic chart per medication (snapshot at export time).
  - Appendix: original vial / prescription photos.
- Branded: ByZyB.ai palette — black background pages where appropriate, electric yellow `#F4EE35` for titles and accents, white body type.
- Filename pattern: `Doozy Health — [Patient name] — [start date] to [end date].pdf`.
- Optional clinician email send (via SES) requires explicit patient consent at the moment of send. Email body is plain, the PDF is the payload.

### 5.11 Unit conversion

- All medications stored in native units (mg, mcg, mL, IU, units, grain).
- Display follows the user's preferred unit system (metric / imperial) per the patient setting.
- Concentration conversion: mg/mL ↔ percentage ↔ mg per pump (for compounded creams) ↔ mg per actuation (for inhalers).
- Cross-jurisdictional translation: a Canadian user reading a US YouTube protocol can see the US protocol's mg dose expressed in their preferred unit. We don't recommend; we translate.
- Syringe visualization always renders the actual volume needed for the chosen dose, given the actual vial concentration the user has on file — not a generic dose-to-volume table.

---

## 6. Non-functional requirements

### 6.1 Regulatory positioning and language

The product is positioned as a **wellness / general-purpose tool**, not a medical device. This is enforced through product, marketing, and store-listing language rules. These rules are not stylistic; they are the line between this product and a regulated medical device under FDA 21 CFR Part 820, the UK MHRA software-as-medical-device guidance, Health Canada's Medical Devices Regulations, and the equivalent regimes in Australia (TGA) and the EU (MDR).

- **The information-vs-instruction line (the governing test).** The product presents information the user interprets and acts on with their clinician. It never makes or recommends a dosing or treatment decision, and never ranks or endorses one regimen over another. Every feature — including any added in future — must pass this test regardless of the words it uses. The phrase rules below are a lexical backstop; this principle is the real boundary.
- **Never** use "treat", "treatment", "diagnose", "diagnosis", "cure", "prevent", or "prescribe" in user-facing copy. The user prescribes (with their doctor); we log.
- **Never** use the phrase "medical advice" except in the negation: *"not medical advice"*.
- **Always** describe the PK view as "illustrative", "based on textbook half-life", or "modeled" — never as "your actual concentration" or "your level".
- **Calibration carve-out (the only place "your" is permitted for a curve):** a curve the user has explicitly calibrated to readings *they entered* (§4.8) may be called "your personal estimate". It must still never be called a measurement, a level, and must always carry the calibrated disclaimer (§4.4, step 8). The carve-out applies only to user-entered calibration, never to the textbook curve.
- The regimen explorer (§4.9) never labels, ranks, or recommends a scenario. It shows shapes.
- **Never** automatically adjust a regimen based on our calculations. The user changes their regimen; we recompute the schedule and chart in response.
- **Always** present drug-interaction information from the curated source with severity and let the user act. We do not say "do not take these together"; we say "these are known to interact — discuss with your doctor or pharmacist".
- **No** symptom checking, condition suggestion, or "what might be wrong" logic anywhere in the product.
- **No** language implying our records are equivalent to a clinical record, EHR entry, or formal medical document. They are a personal diary the user may choose to share.
- **No** gamification of dose-taking — no streaks, no badges, no "X days in a row", no surfaced adherence *score* or percentage, no guilt language on missed doses, and no celebratory animation on a logged dose. A factual **adherence calendar is permitted**: it color-grades each day by logged-versus-scheduled doses (green = taken as chosen, graduated orange = partial, red = due-but-none-logged on a past day) and shows per-medication identity colors. It is a record of what was logged, presented neutrally — today is never "missed", the future shows only scheduled doses, and it never tells the user to dose. Reward / streak / habit mechanics still cross the regulatory line.
- **Footer line on every screen and document:** *"Doozy Health is a wellness tool. It is not a medical device and does not provide medical advice. Consult your doctor."*
- The App Store, Google Play, and marketing site descriptions are reviewed against this list before publication.
- Code, UI copy, and prompt bodies use **American English** (categorize, normalize, summarize, color).

### 6.2 Security and privacy

- **System secrets** (the OpenRouter key, future feed / SMS keys) are encrypted at the application layer with AES-256-GCM using a single key from the `SECRET_ENCRYPTION_KEY` environment variable; the stored envelope is `<iv-hex>:<tag-hex>:<ciphertext-hex>`. The database only ever sees ciphertext plus a masked preview (`sk-or-v…wxyz`). Implemented with an application-layer crypto helper (`lib/crypto.ts` / `lib/secrets.ts`).
- **Health data** is protected by Postgres / Supabase encryption at rest plus Row-Level Security bound to patient membership. It is **not** app-layer field-encrypted by default. If we decide the most sensitive fields (e.g. controlled-substance logs, mental-health medication names) warrant app-layer encryption with a key distinct from `SECRET_ENCRYPTION_KEY`, that is a **deliberate net-new addition** to scope — see §11.
- **Calibration readings are sensitive health data.** `pk_calibrations` rows (§8) are patient-scoped, governed by the membership RLS predicate (§7), and respect the per-medication `is_private` flag. Because a reading can be as revealing as a controlled-substance log, calibration data is included in the flagged net-new decision on app-layer field encryption above; if we adopt app-layer encryption for sensitive health fields, calibration readings are in scope.
- All data encrypted in transit (TLS 1.3).
- **Authentication.** The working baseline is **email magic link** via Supabase Auth (middleware checks `supabase.auth.getUser()`, login is a magic-link form). Passkey / WebAuthn is the intended primary method but is **not yet implemented**; treating it as built is a mistake. Doozy either ships on the magic-link baseline first and adds WebAuthn as a deliberate piece of work, or budgets WebAuthn explicitly. Biometric unlock on installed iOS is desirable once WebAuthn exists.
- Original photos in a private bucket, accessible only via short-lived signed URLs; storage object keys are scoped by patient folder (see the membership caveat in §7).
- User can export all data (machine-readable JSON + the doctor PDF) and delete their account at any time. Deletion is a hard delete with a 30-day grace window.
- No third-party analytics, no trackers, no advertising SDKs in the v1 build.
- Application logs scrubbed of medication names, dosages, and identifying values.
- `extraction_deltas` rows omit patient and medication identifiers by design (§5.2.3). Admin photo views from the Extractions page are server-side redacted and written to `admin_audit_log`.

### 6.3 Performance

- Home screen load < 1.5 seconds on a warm cache.
- Photo extraction round-trip target: median 4 seconds, p95 under 10 seconds. Per-attempt LLM timeout defaults to 30 s (the `llmCall` default).
- Single-tap dose log path: < 200 ms perceived response (optimistic UI; sync in the background).
- App functions fully offline for read; write actions (logs, photos, diary entries) queue and sync on reconnect.

### 6.4 Cross-platform and PWA

- Progressive web app, installable to iOS and Android home screens with proper splash and icon.
- Camera capture via `getUserMedia` or the HTML `capture` attribute, file picker fallback.
- Responsive: single-column on phone, two-column on tablet and desktop.
- Web Push API for reminder delivery on installed PWAs (iOS 16.4+ supports this; on earlier iOS the reminder routes via email or SMS only).
- No native iOS / Android apps in v1.

---

## 7. Technical architecture (proposed)

The stack is chosen for fit with the ByZyB.ai toolchain and the constraints of this product. The one structural point to get right is the scoping model, called out below the table.

| Layer | Proposal | Rationale / note |
|---|---|---|
| **Frontend** | Next.js 16 (App Router) + React 19 + TypeScript 6, Tailwind v4. Installable PWA. Server components by default; `'use client'` only when needed. | No CSS-in-JS, no component library (shadcn/ui only if a real need appears). |
| **Backend** | Next.js route handlers in `app/api/`, server actions for admin mutations; heavier work (PK engine, PDF render, drug-DB sync) in serverless functions. | — |
| **Database** | Supabase (Postgres). **Raw SQL migrations** (forward-only) + `@supabase/supabase-js`. No Prisma, no ORM. | Use hand-written migrations and a `set_updated_at()` trigger on mutable tables; do not introduce an ORM. |
| **Scoping & RLS** | **Membership-based.** Every patient-owned table carries `patient_id`; RLS policies are of the form `patient_id IN (SELECT patient_id FROM patient_memberships WHERE user_id = auth.uid())`. The app carries an **active-patient** context in session. | **Get this right from the first migration.** The patient ↔ user relationship is many-to-many, so there is no single "current patient" at the DB layer — it lives in app session state. Do **not** build a single-scope-per-user helper or default a `patient_id` column to a "current scope" function; resolve everything (table defaults, RLS, storage-folder checks) through `patient_memberships`. |
| **File storage** | Supabase Storage, private `documents` bucket, 25 MB cap, signed URLs. Object key `<patient_id>/<doc_id>.<ext>`. | Storage RLS must check the folder against the caller's **membership set**, not a single current-scope id — see the scoping row above. |
| **Document extraction** | Routed through OpenRouter via `llmCall` (§14.6). Vision-capable primary, 2 fallbacks. Image attached via `opts.images`. | Implemented in `lib/extraction.ts`. |
| **Auth** | Supabase Auth. **Magic link is the implemented baseline**; WebAuthn is intended but unbuilt (§6.2). | A Supabase Auth middleware check + a magic-link login page. No WebAuthn yet. |
| **Reminders** | Web Push API for PWA users; **Twilio** SMS fallback for caregivers without the app. Schedule materializer runs as a cron job. | Net-new. Twilio is a new dependency to flag. |
| **Drug database** | Curated reference: RxNorm + openFDA + DDInter (v1). Daily sync to local `drugs` / `drug_interactions`. | Net-new. |
| **Pharmacokinetic engine** | Deterministic TypeScript service: superposition engine + per-route kernel library (`exponential` / `bateman` / `zeroOrder`) + linearity gate + active-metabolite compartments + opt-in personal calibration (§5.7). | Net-new. Not an LLM job. Reads the `drugs` reference fields and `pk_calibrations`. |
| **PDF generation** | **Puppeteer** server-side render of a styled React component. | Net-new dependency to flag. |
| **Charting** | A charting library for the PK view (e.g. a lightweight SVG charting lib). | Net-new dependency to flag; pick the lightest option and justify it. |
| **LLM gateway** | OpenRouter only, via `llmCall`. Keys in `system_secrets`, never in the runtime env beyond the bootstrap `SECRET_ENCRYPTION_KEY`. | — |

**New dependencies — permitted, but named.** New dependencies are allowed where they earn their place; there is no blanket prohibition. The rule is simply to name each one, its weight, and the alternative considered, so the footprint stays deliberate. Already planned: Twilio (SMS), Puppeteer (PDF render), a charting library (PK view), and a Web Push library / VAPID setup (reminders). No virtualization library is needed for the model picker — the component filters and sorts in memory, fast enough for the OpenRouter catalog.

---

## 8. Data model (entities)

The model is **patient-scoped from day one**, and the patient ↔ user relationship is **many-to-many** via `patient_memberships` (see §7). Table names are snake_case plural by convention (`patients`, `patient_memberships`, `medications`, `prescribed_regimens`, `delivery_forms`, `chosen_regimens`, `dose_logs`, `dose_schedules`, `dose_reminders`, `tracked_fields`, `diary_entries`, `documents`, `exports`, `pk_calibrations`, `drugs`, `drug_interactions`); columns are snake_case; every mutable table has `created_at` / `updated_at timestamptz default now()` with a `set_updated_at()` trigger. The PascalCase labels below are conceptual entity names.

### Patient-scoped entities

| Entity | Key fields |
|---|---|
| **Patient** | `id`, `name`, `date_of_birth` (nullable), `default_unit_system` (`metric` \| `imperial`), `settings` (jsonb), `created_at`, `updated_at` |
| **User** | `id` (= `auth.users.id`, 1:1), `email`, `is_system_admin` (boolean — gates `/admin` §14.1, independent of any patient role), `created_at`, `updated_at` |
| **PatientMembership** | `id`, `patient_id`, `user_id`, `role` (`owner` \| `caregiver` \| `viewer`), `invited_by`, `accepted_at`, `created_at`. Unique on `(patient_id, user_id)`. This join table is the RLS anchor for everything patient-scoped. |
| **Medication** | `id`, `patient_id`, `canonical_drug_id` (→ `drugs`), `display_name`, `is_private` (boolean), `archived`, `created_at`, `updated_at` |
| **PrescribedRegimen** | `id`, `medication_id`, `dose_amount` (numeric), `dose_unit`, `frequency` (jsonb), `route`, `duration_days` (nullable), `prescriber_name` (nullable), `prescription_document_id` (nullable → `documents`), `created_at`. Immutable per prescription — a new prescription is a new row. |
| **DeliveryForm** | `id`, `medication_id`, `form_type` (`vial` \| `patch` \| `pill_bottle` \| `suppository` \| `topical` \| `inhaler` \| `sublingual`), `concentration` (jsonb: `{amount, unit, per_volume, volume_unit}`), `package_count`, `package_unit`, `syringe_spec` (jsonb, nullable: `{capacity_mL, needle_gauge, needle_length_in, unit_markings}`), `expiry_date` (nullable), `batch` (nullable), `manufacturer` (nullable), `source_photo_id` (nullable → `documents`), `created_at` |
| **ChosenRegimen** | `id`, `medication_id`, `dose_amount` (numeric), `dose_unit`, `frequency` (jsonb), `route`, `reason_note` (nullable), `active` (boolean), `created_at`. Only one active per medication. |
| **DoseLog** | `id`, `medication_id`, `scheduled_for` (timestamptz, nullable for PRN), `logged_at` (timestamptz), `amount` (numeric), `unit`, `route_taken`, `site` (nullable), `note`, `source` (`manual` \| `reminder_action` \| `caregiver`), `logged_by_user_id`, `created_at` |
| **DoseSchedule** | `id`, `medication_id`, `chosen_regimen_id`, `next_run_at`, `generated_through`, `last_generated_at` |
| **DoseReminder** | `id`, `schedule_id`, `due_at`, `channel` (`push` \| `sms`), `recipient_user_id`, `status` (`pending` \| `sent` \| `acted` \| `missed`), `action_taken` (`taken` \| `snoozed` \| `skipped` \| `none`), `action_at` |
| **TrackedField** | `id`, `patient_id`, `name`, `field_type` (`number` \| `scale_1_10` \| `boolean` \| `freetext` \| `category`), `unit` (nullable), `category_options` (jsonb, nullable), `display_order`, `active` |
| **DiaryEntry** | `id`, `patient_id`, `entry_at`, `field_values` (jsonb, keyed by `tracked_field_id`), `attached_dose_log_id` (nullable), `note`, `logged_by_user_id` |
| **Document** | `id`, `patient_id` (scope FK), `storage_path` (unique), `file_name`, `mime_type`, `size_bytes` (≤ 26214400), `document_type` (`vial_photo` \| `prescription_scan` \| `patch_box` \| `pill_bottle` \| `lab_result` \| `other`), `linked_medication_id` (nullable), `uploaded_by`, `uploaded_at`, `extracted_json` (jsonb), `status` (`uploaded` \| `processing` \| `extracted` \| `failed`) |
| **Export** | `id`, `patient_id`, `generated_by_user_id`, `date_range_start`, `date_range_end`, `medications_included` (jsonb array), `fields_included` (jsonb array), `output_storage_path`, `generated_at` |
| **PkCalibration** | `id`, `patient_id` (scope FK, RLS via `patient_memberships`), `medication_id`, `value` (numeric), `unit`, `observed_at` (timestamptz), `note` (nullable), `logged_by_user_id`, `created_at`. **Net-new.** User-entered readings that calibrate the PK curve (§4.8, §5.7). Honors the medication's `is_private` flag for caregiver/viewer visibility (§5.6). The derived personal terminal half-life is computed from these rows at render time (`source = user_calibrated`) and **never** overwrites the reference `drugs` value. |

### Reference data (global, read-only to users)

| Entity | Key fields |
|---|---|
| **Drug** | `id`, `rxnorm_id`, `canonical_name`, `atc_class`, `half_life_hours` (jsonb, keyed by route), `half_life_range_hours` (jsonb, keyed by route → `[low, high]`, for the uncertainty band), `bioavailability` (jsonb, keyed by route, 0–1), `tmax_hours` (jsonb, keyed by route), `kernel_by_route` (jsonb, keyed by route → `exponential` \| `bateman` \| `zeroOrder`), `release_duration_hours` (jsonb, keyed by route — zero-order kernels only), `is_linear` (boolean — the linearity gate, §5.7), `nonlinear_reason` (text, nullable — shown when `is_linear = false`), `metabolites` (jsonb array of `{name, fraction, kernel, half_life_hours, tmax_hours}`), `controlled_schedule` (nullable), `reference_data` (jsonb), `last_synced_at` |
| **DrugInteraction** | `id`, `drug_a_id`, `drug_b_id`, `severity` (`info` \| `caution` \| `serious`), `mechanism`, `reference_source` (e.g. `DDInter`, `openFDA`), `last_synced_at` |

### Admin / LLM-infrastructure entities (admin-only, see §14)

Global (not patient-scoped), readable only by `is_system_admin = true` via the SQL helper `is_current_system_admin()`. Field names below match the migrations.

| Entity | Key fields |
|---|---|
| **SystemSecret** | `id`, `key` (unique, e.g. `OPENROUTER_API_KEY`), `value_encrypted` (`iv:tag:ciphertext` hex), `value_masked` (UI preview), `description`, `updated_by`, `updated_at`, `created_at`. **No client RLS policy** — read/written server-side only, through SECURITY DEFINER server actions gated on `is_current_system_admin()`. |
| **SystemSettings** | Singleton (`id boolean primary key default true check (id = true)`). `default_primary_model_slug`, `default_fallback_1_model_slug`, `default_fallback_2_model_slug`, `updated_by`, `updated_at`, `created_at`. New prompts inherit these defaults. |
| **Prompt** | `id`, `slug` (unique, constrained `^[a-z][a-z0-9_]*$`), `name`, `description`, `purpose` (`extraction` \| `classification` \| `summary` \| `other`), `current_version_id` (deferrable FK → `prompt_versions`), `status` (`active` \| `disabled`), `created_at`, `updated_at` |
| **PromptVersion** | `id`, `prompt_id`, `version_number`, `body` (with `{{variable}}` placeholders), `available_slugs` (jsonb array), `notes`, `created_by`, `created_at`. Unique on `(prompt_id, version_number)`. Editing creates a new version; old versions retained. |
| **PromptBinding** | `prompt_id` (PK, 1:1), `primary_model_slug`, `fallback_1_model_slug` (nullable), `fallback_2_model_slug` (nullable), `temperature` (numeric(3,2), default 0.2), `max_tokens` (default 2048), `response_format` (`text` \| `json`), `json_schema` (jsonb, nullable), `updated_by`, `updated_at` |
| **OpenRouterModel** | `slug` (PK, e.g. `anthropic/claude-opus-4`), `name`, `provider`, `context_length`, `input_cost_per_mtoken` (numeric(12,4)), `output_cost_per_mtoken`, `supports_vision`, `supports_tools`, `supports_json_mode`, `is_coding_specialist`, `is_reasoning_specialist`, `is_available`, `last_synced_at`, `raw` (jsonb — full provider response for forensics). Refreshed daily; models that drop out are marked `is_available = false`, never deleted. |
| **LLMCallLog** | `id`, `prompt_slug`, `model_used`, `was_fallback` (smallint 0/1/2), `latency_ms`, `input_tokens`, `output_tokens`, `cost_usd` (numeric(12,6), nullable — computed in a follow-up), `success`, `error_message` (nullable), `was_test` (boolean, default false), `actor_id` (nullable — set for admin test calls only), `created_at` |
| **AdminAuditLog** | `id`, `actor_id`, `entity` (e.g. `system_secret`, `prompt`, `prompt_binding`, `extraction_delta`), `entity_id`, `action` (`create` \| `update` \| `delete` \| `view_source`), `diff` (jsonb — before/after for non-secret fields; `"secret updated"` sentinel for secrets), `created_at` |
| **ExtractionDelta** | `id`, `document_id` (nullable — source photo for admin inspection), `drug_canonical_name`, `prompt_slug`, `prompt_version_id`, `model_used`, `field_name`, `direction` (`llm_to_user` \| `user_to_llm`), `llm_value`, `user_value`, `llm_confidence` (`high` \| `medium` \| `low`, nullable), `admin_annotation` (`unreviewed` \| `expected` \| `extraction_miss`, default `unreviewed`), `created_at`. **Net-new.** Patient and medication identifiers deliberately omitted (§5.2.3). Powers the Extractions page (§14.7). Admin "view source" actions logged to `admin_audit_log`. |

---

## 9. UI / UX principles

- **One-tap-to-log** from the home screen. The medication card with its "Taken" button is the largest control on mobile.
- **Confirmation, not configuration.** The AI extracts; the user confirms. Power users can edit, but the default path is fast.
- **Calm, dense, monochrome with one accent.** ByZyB.ai palette: electric yellow `#F4EE35` accent over a neutral monochrome ramp. No celebratory animation when a dose is logged — health logging should feel matter-of-fact, never gamified. (Keep a monochrome discipline with a single, sparingly-used accent — ByZyB yellow.) **The palette is deliberately neutral so that purposeful color earns the eye: per-medication identity colors and adherence-calendar status grading (green/orange/red) are the sanctioned exceptions, and should be the only saturated color in the UI.**
- **Two themes — dark (default) and light.** The app ships both. Dark on `#000000` is the default and the brand-forward look; a **light theme** (near-white background, near-black type) is offered for readers who find dark mode hard — many older users do. Implemented with the *same* semantic color tokens (one set of variables, two value sets) so every screen adapts automatically; the **accent stays electric yellow in both** and on-accent text stays dark. The choice is a single toggle in the global footer, follows the OS preference by default, and persists. Both themes obey every rule above (monochrome discipline, no red zones on the PK chart, sanctioned colors only).
- **Numbers and times are the hero.** Large, tabular figures (`font-variant-numeric: tabular-nums`) for dose amounts and times. Right-aligned in lists. Units present but de-emphasized in display; prominent when entering or editing.
- **The syringe visual is the product moment for injectables.** Treat it with deliberate craft: calibrated to the user's actual syringe spec, accurate volume rendering, clear "fill to this line" guidance. No clip-art.
- **The half-life view is informational, not alarmist.** No red zones, no "danger" coloring, no "you should dose now" prompts. *(This non-directive, no-warning-color rule applies to the PK concentration chart; it does not apply to the adherence calendar, where a red cell is a factual record of a past day with doses due but none logged.)* The curve, the uncertainty band, the trough, the time, the missed-dose shape, the chosen-vs-prescribed overlay — all illustrative. A user-calibrated curve (§4.8) is clearly tagged "your personal estimate" and sits alongside the textbook curve. The regimen explorer (§4.9) shows shapes and never ranks them. Disclaimer inline.
- **No streak counters. No "X days in a row" gamification.** This is a diary, not a habit app. *(A factual adherence calendar — a record of logged-versus-scheduled doses, color-graded per day — is not a streak or a score, and is permitted.)*
- **Staleness is visible without alarm.** A medication not logged against in a while is marked (an amber-dot marker works well), but the tone is neutral ("last logged 4 days ago"), never accusatory.
- **Privacy mode:** single-tap blur of all medication names and dose amounts for over-shoulder situations. Implement as global state, not per-component.
- **Caregiver context is always visible.** The top bar makes clear which patient is active when a user has more than one. Switching patients is one tap. (The active-patient selector is net-new.)

---

## 10. Out of scope for v1 — future considerations

- Passkey / WebAuthn authentication (intended primary, not yet built — see §6.2). v1 may ship on magic link.
- App-layer field encryption of the most sensitive health data with a key distinct from the system-secret key (see §11).
- Wearable integration (Apple Health, Whoop, Oura, Eight Sleep) to populate diary fields automatically.
- Native iOS / Android apps with deeper camera, widget, and notification integration.
- Clinician-facing read-only view via shared link (v2 — the `viewer` role supports it; UI not built).
- Pharmacy connections for refill orchestration.
- Insurance integration.
- Pill identification from a loose pill or partial label.
- HL7 / FHIR export for direct EHR ingestion (the PDF is the v1 export format).
- Family history and genetic context for interaction relevance (closer to the medical-device line — not pursued without further regulatory review).
- Multi-language support beyond English (v2). The drug reference data is largely English-canonical in v1.

---

## 11. Risks and resolved decisions

### Risks

- **Scoping model must be membership-based from the first migration.** A significant implementation risk: if any table defaults a `patient_id` to a single "current scope" function, or if storage-folder RLS assumes one scope per user, multi-patient/caregiver access breaks silently. Mitigation: build a membership predicate from the first migration; never default a `patient_id` column to a "current patient" function; carry the active patient in app session state; write the storage-RLS folder check against the membership set.
- **Regulatory drift.** Feature creep can turn the diary into a medical device. Mitigation: language rules in §6.1 enforced at code review; every new feature checked against the wellness positioning before build; quarterly review against MHRA / FDA / Health Canada SaMD guidance.
- **Personal calibration shifts the regulatory character (launch dependency).** Calibration (§4.8/§5.7) moves Doozy from generic illustration toward individualised modeling — the one v0.4 feature that could affect the software-as-medical-device determination. It is designed to stay a wellness tool (user-entered data, illustrative output, no measurement claim, no dose), but the determination is a legal one, not a design one. Mitigation: before calibration ships in any territory, the SaMD classification is reviewed with regulatory counsel for that territory (US FDA, UK MHRA, Health Canada, Australia TGA, EU MDR). This gates the **release of the calibration feature**, not the rest of v1 — the textbook engine, explorer, and all other features can ship ahead of it.
- **Drug interaction false negatives.** A curated source can miss interactions. Mitigation: "not exhaustive — speak with your pharmacist" framing on every interaction display; uncovered free-text "other medications" field for the doctor PDF; the `extraction_deltas` table to spot weak fields/drugs.
- **Caregiver permissions overreach.** A caregiver-by-default visibility model can be misused in coercive relationships. Mitigation: role distinction; per-medication `is_private` flag; owner can revoke at any time; audit log of caregiver views on private-eligible categories.
- **Reminder fatigue.** Mitigation: smart consolidation; escalation only after a missed dose; per-medication mute; schedule defaults to the minimum cadence implied by the chosen regimen.
- **Storing health data with photo identifiers is a high-value target.** Mitigation: Supabase at-rest encryption + RLS, short signed-URL TTLs, audit logging, clear deletion path; `extraction_deltas` carry no patient/medication FK and source-photo views are redacted and audit-logged.
- **AI hallucination in the interaction explanation prompt.** Mitigation: the prompt takes only the passed-in curated fields and explains those; defensive JSON parse/validate; the curated record is shown verbatim alongside the LLM rendering.
- **Auth maturity gap.** The working baseline is magic link, not WebAuthn. Treating WebAuthn as done would mis-estimate the build. Mitigation: §6.2 records the real baseline; WebAuthn is scoped as explicit work, not assumed.

### Decisions resolved

| Question | Decision |
|---|---|
| Database — Supabase or SQLite? | **Supabase**, with raw SQL migrations and `supabase-js`. No ORM. Multi-party access, server-side reminders, image storage, and cross-device sync require a backend. |
| How is patient data scoped — single-scope-per-user or membership-based? | **Membership-based.** Patient ↔ user is many-to-many via `patient_memberships`; RLS uses a membership predicate; the active patient lives in session state. A single-scope-per-user helper cannot express the many-to-many caregiver model. |
| Drug interactions — LLM-derived or curated source? | **Curated source as ground truth.** The LLM only renders curated records via `explain_interaction`; it never enumerates. |
| Should the PK view ever say "you should take a dose now"? | **No.** Illustrative only. The user changes the regimen; we recompute. |
| How is the PK engine structured? | **Superposition engine + per-route kernel library + linearity gate** (§5.7). Non-linear drugs (saturable, auto-inducing) are gated out of curve rendering rather than modeled wrongly. |
| Personal calibration and the regimen explorer in v1? | **Yes, both — inside the §6.1 information-vs-instruction line.** Calibration fits a curve to user-entered readings (never a measurement, never a dose); the explorer renders user-constructed scenarios (never ranked or recommended). Calibration's *release* carries a per-territory SaMD review dependency (§11 Risks); the explorer does not. |
| Should caregivers see everything by default? | **All non-private medications.** A per-medication `is_private` flag (owner-set) excludes specific medications regardless of role. |
| Should diary fields have imposed defaults? | **No.** Onboarding suggests fields via `suggest_diary_fields`; the user picks. |
| Single-user only, or multi-party data model? | **Multi-party from day one** (`patient_memberships`). v1 UI surfaces one active patient; a patient switcher arrives with caregiver invitations. |
| Wellness or medical-device positioning? | **Wellness / general-purpose.** Codified in §6.1. |
| LLMs anywhere on the dosing math? | **No.** Pharmacokinetics is deterministic backend code. LLMs do only fuzzy work — extraction, normalization, interaction explanation, diary suggestion, free-text classification. |
| Gamify dose-taking with streaks or badges? | **No.** Reframes the diary as behavior-modification and crosses the regulatory line. A *factual* adherence calendar (color-graded by what was logged) is permitted — it is a record, not a streak or score. See §6.1, §9. |
| Manual entry first-class or fallback? | **First-class, with optional verification photo** logged as `user_to_llm` deltas. |
| Track LLM vs user divergences? | **Yes**, in a system-level `extraction_deltas` table with no patient/medication FK. Aggregates power the Extractions page (§14.7). |
| App-layer encryption for health data? | **Flagged as a net-new decision.** System secrets are encrypted at the app layer; health data relies on at-rest encryption + RLS. If sensitive health fields warrant app-layer encryption with a separate key, scope it explicitly — do not assume it exists. |
| Authentication method for v1? | **Magic link is the working baseline.** WebAuthn is intended but unbuilt; ship on magic link or budget WebAuthn as explicit work. |

---

## 12. Success metrics

- **Time from app open to dose logged:** median under 10 seconds for scheduled doses.
- **Logging consistency:** percentage of scheduled doses with a log entry within 24 hours — target 80% after the user's first 30 days.
- **Photo extraction accuracy:** > 90% on common vial / prescription formats after three successful captures of the same medication. Tracked at the system level via per-field correction rates on the Extractions page (§14.7).
- **Verification-photo attach rate:** percentage of manual-entry medications that receive an optional verification photo within 7 days.
- **Caregiver activation rate:** for users who invite a caregiver, percentage where the caregiver logs at least one dose within 7 days of accepting.
- **Export usage:** percentage of monthly-active users who generate at least one PDF export within their first 90 days.
- **User-perceived trust:** the user is willing to use only Doozy Health as their dose record without a backup spreadsheet or notes app — single-question in-app survey at 60 days.

---

## 13. Suggested build sequence

1. **Auth + empty shell + scoping foundation.** Magic-link sign-in. `patients`, `users` (id = `auth.users.id`), and `patient_memberships` from day one, with the **membership-based RLS predicate** and an on-signup trigger that provisions a patient + an `owner` membership. `is_system_admin` flag on `users`. Active-patient session context. Deploy.
2. **Manual medication creation.** Three-layer regimen (prescribed / delivery form / chosen) entered manually. Home screen with medication cards. Drug name free text for now.
3. **Reference drug database.** `drugs` / `drug_interactions` populated from RxNorm + DDInter; daily sync cron. Medication-add does a drug-name lookup.
4. **Dose logging.** One-tap log; custom-amount path; dose history per medication.
5. **Photo upload (no AI yet).** Capture and link to medication; private bucket, signed URLs, `<patient_id>/<doc_id>.<ext>` keys; storage RLS against the membership set. Photo attachable both as the primary path and as a post-manual-entry attachment.
6. **Admin backend foundation (§14).** `system_secrets` (encrypted via `SECRET_ENCRYPTION_KEY`), `system_settings` singleton, OpenRouter key, model catalog sync from `/models`, `llmCall(promptSlug, vars, opts?)` with primary + 2 fallback chain and `llm_call_logs` writes. Bootstrap key in `.env.local` only.
7. **Admin Prompts page (§14.4).** Prompt list, editor with `{{slug}}` awareness, model picker (in-memory filter/sort, capability/cost/context indicators), primary + 2 fallback binding. Test panel with its own rate limit (10/min).
8. **AI extraction — vials, with `extraction_deltas` logging.** `extract_vial` wired into the medication-add flow; image via `opts.images`; confidence + thumbnail + confirm UI; defensive JSON parse/validate. On confirm, write one `extraction_deltas` row per changed field (`llm_to_user`). The manual-with-verification-photo flow also lands here (`user_to_llm`).
9. **AI extraction — prescriptions.** `extract_prescription` + `normalize_drug_name`. Delta logging continues across both flows.
10. **Admin Extractions page (§14.7).** Aggregates over `extraction_deltas` (per field / drug / prompt version / model / direction). Drill-in with redacted "view source" (audit-logged). Admin annotation (`expected` vs `extraction_miss`).
11. **Pharmacokinetic engine and visualization.** Deterministic service: superposition engine + per-route kernel library (`exponential` / `bateman` / `zeroOrder`) + linearity gate + active-metabolite compartments. Chart with permanent disclaimer, uncertainty band, projected trough, missed-dose shape, chosen-vs-prescribed overlay, and time-to-steady-state for new meds. Then the **regimen explorer** (user-driven, no ranking) and **opt-in personal calibration** (`pk_calibrations`, terminal-half-life back-solve, "your personal estimate" tagging) — calibration's territory release is gated on the §11 SaMD review. (Charting dep flagged.)
12. **Reminders engine.** Schedule generator; Web Push registration; Twilio SMS for caregivers without the app. (Deps flagged.)
13. **Caregiver model UI.** Invite flow; `patient_memberships` management; role-based access; private-medication flag; patient switcher. (RLS already in place from step 1.)
14. **Drug interaction display.** Pairwise check on medication add; `explain_interaction` renders the curated record.
15. **Diary / custom fields.** Per-patient field config; entry attached to a dose log or free-standing; `suggest_diary_fields` in onboarding.
16. **PDF export.** Puppeteer server-side render; configurable range / medications / fields; branded layout. (Dep flagged.)
17. **PWA install polish, offline cache, privacy-mode blur, staleness indicators.**

---

## 14. Admin backend (LLM infrastructure)

All LLM interactions route through **OpenRouter** via the `llmCall` service. The admin backend manages this infrastructure — and surfaces the extraction-quality feedback loop — without touching application code or redeploying. It is a self-contained module; the seed prompts and the Extractions page are specific to Doozy.

### 14.1 Access and visibility

- Mounted at `/admin`, gated by `requireSystemAdmin()` (a server helper that resolves the session, then calls `notFound()` for non-admins) layered over the SQL helper `is_current_system_admin()` used in every admin RLS policy. Non-admins get a **404, not a 403**.
- Regular users never see admin links or any reference to OpenRouter, model names, prompts, or costs.
- The flag is set by direct DB write or a seed script — no UI to grant admin in v1.
- Every admin route re-checks the flag server-side on each request (the layout calls `requireSystemAdmin()`); client state is never trusted for admin access.

### 14.2 Page structure

Three pages.

| Page | Path | Purpose |
|---|---|---|
| **Settings** | `/admin/settings` | API keys, default models (`system_settings`), model catalog sync status, recent call logs. |
| **Prompts** | `/admin/prompts` | List of prompts with slugs; detail view edits the body and binds a primary + 2 fallback models. |
| **Extractions** | `/admin/extractions` | System-wide extraction quality: aggregate `extraction_deltas` by field, drug, prompt version, model, and direction, with drill-down. |

The admin nav is a hardcoded header — adding Extractions is a third link.

### 14.3 Settings page (`/admin/settings`)

- **API keys.** OpenRouter key entry, write-only; the UI shows the `value_masked` preview (`sk-or-v…wxyz`), never the raw value. Stored as a `system_secrets` row, encrypted via `lib/crypto.ts`, decrypted only server-side inside `readSecret()`. Future keys (drug-DB feeds, Twilio, SES) live here too.
- **Defaults.** The `system_settings` singleton: a default primary model and two default fallbacks. New prompts inherit these.
- **Model catalog.** Status of the OpenRouter `/models` sync — last refresh, count cached, manual "Refresh now". Auto-refreshes daily via cron. Models that drop out are marked `is_available = false`, not deleted.
- **Cost dashboard.** Aggregated `llm_call_logs`: spend last 7 days, top prompts by spend, fallback rate. (`cost_usd` is currently logged null pending price-lookup wiring; the dashboard degrades gracefully until then.)
- **Recent calls.** Last 50 calls: prompt slug, model, primary / fallback 1 / fallback 2, latency, tokens, success/failure with inline error.

### 14.4 Prompts page (`/admin/prompts`)

#### 14.4.1 List view

Columns: **Slug** (the stable identifier code calls, e.g. `llmCall('extract_vial', { ... }, { images })`), **Name**, **Purpose**, **Available slugs** (the `{{variable}}` placeholders), **Bound primary model**, **Fallbacks** (count + on hover), **Last edited**, **Status** (active / disabled). "New prompt" creates a blank prompt. Slugs are immutable once referenced in code and constrained to `^[a-z][a-z0-9_]*$`.

#### 14.4.2 Detail / edit view

Two panels.

**Left — prompt editor:** read-only slug; editable name/description/purpose; managed `available_slugs` list with a typo guard that highlights any `{{...}}` in the body not in the declared list; a monospaced body editor; saving creates a new `prompt_versions` row (old versions retained, viewable from version history); a test panel that runs the prompt against the bound primary with its own sliding-window rate limit (10 test calls/min/admin, tracked via `was_test` + `actor_id` on `llm_call_logs`).

**Right — model binding:** primary, fallback 1, fallback 2 (model picker, fallbacks nullable); temperature (default 0.2), max tokens (default 2048), response format (text / json), optional JSON schema. Save writes the `prompt_bindings` row.

### 14.5 Model picker

Reused for primary + both fallback slots. A client component that loads the `openrouter_models` cache and **filters / sorts in memory** (no virtualization library, and none needed for the catalog size).

- Search by name, provider, or capability.
- Capability badges per row: 🅥 vision, 🅒 coding, 🅡 reasoning, 🅣 tools, 🅙 JSON. (Derived by heuristic during model sync.)
- Cost per row (`$in / $out per MTok`), context window, provider grouping (toggleable), sortable by cost / context / name.
- Unavailable models (`is_available = false`) shown dimmed and not selectable.

### 14.6 Runtime call flow — `llmCall`

`llmCall(promptSlug: string, vars: Record<string, string>, opts?): Promise<LlmCallResult>` is the only path from app code to a model. Notes that matter for building on it:

- `vars` are **strings only**, substituted into `{{slug}}` placeholders in the prompt body. Missing vars are left intact (no throw), which is what the editor's typo guard is for.
- **Images attach via `opts.images`** (an array of base64 data URLs), sent as a multipart user turn alongside the rendered body — not through a `{{placeholder}}`. `opts` also carries `systemMessage`, `extraMessages`, `timeoutMs` (default 30 s), and `isTest` / `actorId` for admin test calls.
- Flow: load `prompts` by slug (must be `active` with a `current_version_id`) → load `prompt_versions.body` + `prompt_bindings` → render → try primary, then fallback 1, then fallback 2. A failure is a 5xx, timeout, empty response, JSON-schema validation failure, content filter, or model-offline error.
- Returns a **discriminated union**: `{ ok: true, text, modelUsed, wasFallback }` or `{ ok: false, error, attempts }`. The result is raw `text`; callers parse/validate JSON themselves (see §5.2).
- Every attempt is written to `llm_call_logs` with `was_fallback` ∈ {0,1,2}.

### 14.7 Extractions page (`/admin/extractions`)

The system-improvement feedback surface. Aggregates `extraction_deltas` into views that answer "where are extractions diverging from user truth, and what should we change?"

**Aggregate cross-tabs** (rolling 30 / 90 day windows, sortable): **per field** (correction rate, e.g. `concentration_amount` on 18% of `extract_vial` runs); **per drug** (which drugs / label formats are hardest); **per prompt × version** (so a new `prompt_versions` body can be measured against the previous one — a drop is a win, a rise is a revert signal); **per model** (correction rate per bound primary); **per direction** (`llm_to_user` vs `user_to_llm` — a high `user_to_llm` rate is a UX signal that users mis-enter a field).

**Drill-in.** Tapping a row reveals the underlying `extraction_deltas`: timestamp, field, LLM value, user value, direction, confidence, model, prompt version, annotation. Each row has a "view source" action that renders the linked `documents` photo with patient-identifying metadata redacted by a server-side pre-render pass; each view is written to `admin_audit_log` (`action = view_source`).

**Admin annotation.** Each delta is `unreviewed` (default), `expected` (LLM was right, user introduced the error during confirm — excluded from the per-field rate so typos don't drag the metric), or `extraction_miss` (confirmed failure, stays in the rate).

**Privacy posture.** `extraction_deltas` omits patient and medication identifiers (§5.2.3, §8). Aggregates are counts and rates only. Source-photo views are deliberate, rate-limited, and audit-logged.

### 14.8 Initial prompts (suggested seed)

Seed prompts ship **disabled** with a placeholder body and a default binding (the default seed binding points at `anthropic/claude-opus-4` primary, `anthropic/claude-sonnet-4` and `openai/gpt-4o` fallbacks; tune in `/admin/settings`). An admin writes the real body and enables each one. The `available_slugs` below are the **text** placeholders only — for the two vision prompts, the image is supplied at call time through `opts.images`, not as a placeholder.

| Slug | Purpose | Text placeholders | Image via `opts.images`? |
|---|---|---|---|
| `extract_vial` | Read a vial / packaging photo → structured fields (canonical + raw drug name, strength, concentration, volume, expiry, batch, manufacturer, route hints). | `{{known_medications}}`, `{{user_default_units}}` | Yes |
| `extract_prescription` | Read a prescription (photo or pasted text) → drug, dose, frequency, duration, route, prescriber, refills. | `{{known_medications}}`, `{{prescription_text}}` (text case) | Yes (photo case) |
| `normalize_drug_name` | Map a raw drug name to a canonical `drugs` record. | `{{raw_name}}`, `{{known_drugs}}`, `{{user_locale}}` | No |
| `explain_interaction` | Render a curated interaction record in plain English. **Does not enumerate.** | `{{drug_a_name}}`, `{{drug_b_name}}`, `{{mechanism}}`, `{{severity}}`, `{{user_reading_level}}` | No |
| `suggest_diary_fields` | Suggest tracking fields based on the user's medications. | `{{medication_list}}`, `{{user_stated_concerns}}` | No |
| `classify_dose_event` | Disambiguate a vague free-text log ("I took it") into a structured event. | `{{raw_log_text}}`, `{{recent_schedule}}`, `{{recent_logs}}` | No |
| `summarize_diary_freetext` | Convert a free-text symptom note into structured tags for the doctor PDF. | `{{note_text}}`, `{{patient_tracked_fields}}` | No |

### 14.9 Security notes specific to the admin backend

- `system_secrets` is encrypted at the application layer (AES-256-GCM, `SECRET_ENCRYPTION_KEY`) and has **no client RLS policy** — it is reached only through SECURITY DEFINER server actions gated on `is_current_system_admin()`.
- Admin actions (key updates, prompt edits, binding changes, extraction-delta annotations, and Extractions "view source") are written to `admin_audit_log` with `actor_id`, `entity`, `entity_id`, `action`, and a `diff` (before/after for non-secret fields; `"secret updated"` sentinel for secrets).
- No admin page is server-side cacheable; every load runs the middleware admin check.
- Prompt test runs use a separate sliding-window rate limit (10/min/admin) keyed on `was_test` + `actor_id` in `llm_call_logs`.

---

## 15. Testing requirements

No tests run against live OpenRouter, ever. Mock the provider at the `callOpenRouter` boundary.

**`llmCall` fallback chain.** Force a primary failure → assert the call lands on fallback 1; force two failures → fallback 2; force three → the `{ ok: false, error, attempts }` result with the full attempt chain. Assert every attempt writes an `llm_call_logs` row with the correct `was_fallback` value.

**Pharmacokinetic engine (§5.7).** A known dose history against a known half-life produces the expected concentration curve and projected trough. Cover the "missed dose, re-spread across the remainder of the period" case and the chosen-vs-prescribed overlay computation. This is the most correctness-sensitive deterministic code in the product — test it hard. Specifically:
- **Kernel correctness, per type.** Exponential, Bateman (Tmax-derived absorption), and zero-order kernels each reproduce known single-dose curves and superpose correctly over a known dose history.
- **Linearity gate.** A drug flagged `is_linear = false` returns the honest no-curve panel and **no** trough projection — asserted, not merely styled.
- **Active-metabolite modeling.** A drug with `metabolites` parameters produces parent and metabolite series with the expected shapes.
- **Uncertainty band.** The shaded region matches `half_life_range_hours` bounds.
- **Missed-dose shape.** A logged gap renders the expected dip; the engine never emits a corrective dose value in any field of the response.
- **Calibration maths.** Two decline-phase readings back-solve the expected terminal half-life; implausible fits are rejected and the textbook curve is retained; only the terminal half-life moves (Tmax unchanged). `pk_calibrations` is patient-scoped and respects `is_private` under a direct query.
- **Regimen explorer.** A user-constructed scenario renders a curve; the response contains no ranking, "better/optimum" flag, recommendation, or write-back to the live chosen regimen.
- **The §6.1 line holds in code.** No PK endpoint returns a dose-to-take, a regimen endorsement, or a position-triggered directive — for any drug, linear or not, calibrated or not.

**Defensive extraction parse (§5.2).** The JSON parser tolerates ```json fences and trailing prose, extracts the first `{`…`}`, and rejects invalid enum values (unknown route, unknown form type) rather than persisting them.

**Scoping and visibility (§7, §5.6).** The membership RLS predicate grants access only to patients the caller is a member of. The `is_private` override is enforced in the predicate, not just the UI: a caregiver cannot read a private medication even with a direct query.

**ExtractionDelta privacy (§5.2.3).** A test asserts that `extraction_deltas` rows never carry `patient_id` or `medication_id`. This is a privacy invariant, not a nicety — it should fail loudly if a future change reintroduces an identifier.

**Extraction review is never auto-committed (§5.2.1).** Integration test: post a sample vial photo → assert an extraction review card is returned (not a committed medication) → assert that confirming creates the medication and writes the expected `extraction_deltas` rows with the correct direction.

**Reminder schedule generation (§5.5).** A chosen regimen materializes the expected `dose_reminders` rows over the window, including the smart-consolidation case (two medications due within the window collapse to one notification) and the escalation case (an unlogged dose past the threshold notifies the caregiver).

---

*— End of document —*
