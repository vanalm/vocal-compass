# Vocal Compass: science, measurement and experience audit

**Audit date:** 2026-09-29

**Audited base:** `4a1083e937f4fa8fc6a3ef889ca96a348b4a907c`

**Implementation branch:** `audit/science-progress-2026-09-28`

**Status:** implemented and locally tested; release validation remains open. Not deployed by this audit.

## Executive finding

The central product idea is worth testing: distinguish a singer's observed pitch, intended destination, support needs and performance under silence or musical context. The original implementation did not reliably maintain those distinctions. It could present a favorable practice change as personal improvement while its “blind baseline” allowed unsuccessful attempts to be discarded. Several scientific claims went beyond their cited evidence.

The finishing work therefore prioritizes **honest measurement before attractive charts**. The revised app is an evidence-informed practice tool with a controlled collection protocol, explicit limitations and inspectable records. It is not a validated diagnostic, clinical intervention, guaranteed range program, or completed efficacy study.

## Scope and method

Reviewed the current repository's exercise definitions, scoring, timing, microphone lifecycle, range routines, KPI/recommender logic, data handling, UI and research documents against the original product intent. Inspected the actual implementation, not only screenshots or the older prototype. Ran the existing test suite before editing, then added or corrected regression tests.

The literature review is targeted and claim-level. It is **not a systematic review**, exhaustive search of all 2026 research, meta-analysis or independent risk-of-bias assessment. The source register contains eleven primary-study/agency entries. Publisher abstracts, PubMed abstracts, accessible article content and the author's dosage-study abstract were used at the depth identified on each card. Paywalled or challenge-blocked full texts were not represented as read. Numerical effect-size bands not directly substantiated were removed, not guessed.

### Principal research corrections

| Issue | Correction and supporting source |
|---|---|
| Imagery described as the user's established bottleneck | A plausible hypothesis. [Imagery association](https://pubmed.ncbi.nlm.nih.gov/23413013/) and [interference experiment](https://pubmed.ncbi.nlm.nih.gov/40325328/) do not validate this individual's diagnosis or this training schedule. |
| Visual feedback described as a settled causal answer or demonstrated dependence | Results vary with study/task. The [short combined-feedback study](https://doi.org/10.1177/03057356211026730) and [ten-week study](https://doi.org/10.1177/0305735619854534) justify trying support and measuring separately, not claiming a universally optimal fade. |
| A realistic relative-error band treated as support for a fixed percentage-point accuracy target | Removed: these are different outcome scales and the conversion was not established. |
| “Once daily was insufficient” attributed to the VFE dosage study | Incorrect manipulation: the [primary author abstract](https://uknowledge.uky.edu/commdisorders_etds/8/) describes different repetition counts, all twice daily. |
| Three semitones treated as a real individual range change | Removed. [Laboratory retest drift](https://doi.org/10.1016/j.jvoice.2017.03.019) does not calibrate this browser instrument or an individual minimum detectable change. |
| Wider pitch-matching practice treated as support for higher singing range | [The study](https://doi.org/10.1177/10298649241289542) tests matching accuracy, not higher belting or physiological range expansion. |
| An app trill routine presented as the VFE program | Renamed optional exploration. [The original VFE trial](https://pubmed.ncbi.nlm.nih.gov/7987430/) does not validate this derivative routine. |
| Eight-week document contradicted twelve-week in-app sequence | Unified as a flexible eight-week experiment, with later extension optional and no promised effect or dose. |

See the in-app **Guide → Research library** for study population/task, finding, what it does not establish, design choice and DOI/PubMed links. The [protocol decision](training-protocol-decision.md) preserves genuine alternatives and reconsideration triggers rather than portraying every alternative as inferior.

## Findings and implementation

| Priority | Finding at audited base | Resolution / boundary |
|---|---|---|
| Critical | Check-in offered “Retry (this one won't count)” after revealing the result | Replaced with first-attempt collection, automatic save after capture, no score-based retry and no results until the end. Incomplete blocks stay incomplete. |
| Critical | No durable test/block/version provenance; practice and test observations mixed | Additive metadata identifies purpose, block/item, form, home note, first-take status, scoring/protocol versions and cue replays. Legacy remains separate. |
| Critical | First-ten vs last-ten arbitrary practice trials were labelled improvement | Replaced with complete matched blocks on different days. No test of causation or “real change” badge. |
| Critical | No correct matches could produce zero-cent residual | Missing value now stays missing. Numerators, denominators and capture coverage are visible. |
| High | Median of the early 900-ms pitch path could erase an initial wrong stable note | First locally stable segment is preserved; transient frames and long gaps do not establish a note. Rules are explicit engineering thresholds. |
| High | Rounded frame transitions could interpret vibrato as repeated searching | Stable-center/hysteresis logic replaces frame-by-frame center counting; inference remains tentative. |
| High | Acoustic destination, final intent label and success were conflated across calculators | First-note hit rates use acoustic matches. Intent remains a separate optional explanation. No automatically inferred “target availability” metric. |
| High | Retention curve pooled unrelated exercises and support conditions | Restrict retained compatibility calculation; visible progress prioritizes matched check-ins and labels descriptive practice filters. |
| High | Input permission latency could contaminate silent retention; replays unlogged | Initialize input/audio before model; record actual silence and replay counts; reject out-of-tolerance silent check-in items from comparisons. |
| High | Synthesized phrase accompaniment could overlap scored capture | Stop accompaniment during scored singing. Keep phrase results as practice, never validated cold transfer. |
| High | Lost-to-first-voicing was treated as successful recovery | Metric withheld. Correct-restart recovery instrumentation is explicitly still needed. |
| High | Safety statements exceeded what microphone features can know | Readiness gate before singing, explicit stop, optional range lane, source-linked limitations. These safeguards are not clinical validation. |
| Medium | “Every result opens to evidence” was not implemented in history | Details now opens a real modal with trace, context, acoustic explanation, optional intent and replay/timing metadata. |
| Medium | Guide had no navigable research register; claims lacked nearby limitations | Add searchable eleven-source library, per-exercise evidence disclosures, method, alternatives, measurement definitions and voice/data sections. |
| Medium | Seven equally prominent primary screens and abstract numbers obscured next action | Four primary destinations, a personal musical goal, one next-action card and practice sub-navigation. |
| Medium | No-data and old-data UI could imply zero performance or a valid baseline | Explicit starting states, legacy filter, unscored coverage and incomplete-block status. |
| Medium | Save failures/cancellation could cause duplicated attempts or continuing media | Stable IDs, retry-safe trial save, error retention, capture/playback stop and generation checks. Live browser behavior remains a release gate. |
| Medium | Browser storage fallback was invisible | Warn when only transient in-memory storage is available. Goal wording remains local and is not silently synced. |

## User experience and goals

**Today** answers what to do next, what counts as progress, and how the work serves a musical goal. The goal is editable on the device; no private user details are embedded in source. A next-note goal and a high-range technique goal remain distinct.

**Practice** offers Check-in, Pitch, Phrases and Range. Readiness is checked before microphone work. Live aids are available for learning, while the check-in removes online pitch guidance. The rule-based Pattern completion name now describes the task actually implemented: it is not a missing-note test from a modeled song.

**Progress** starts with comparable observations, not a pooled all-purpose singing score. The user can inspect an observed difference, dates, uncertainty, scorable counts, actual attempts and their conditions. Practice, check-in and legacy filters stay distinct. Phrase history is labelled practice; range is a separate observed span. Export/account controls are explicit.

**Guide** keeps explanatory depth out of the daily path. It includes the loop, bounded experiment, alternatives, study-level limits, source links, metric definitions, privacy and safety. Hash-linked sub-sections make it returnable and shareable.

The visual pass uses restrained dark surfaces, a consistent accent, readable hierarchy, semantic buttons, visible keyboard focus, four primary destinations and responsive cards. Research is collapsed by default and searchable. Dense data tables scroll within their cards instead of forcing the page wider than a phone. Design-review data is prominently labelled fabricated and isolated from real storage.

## Verification performed

- Baseline before modifications: **395 tests in 39 files passed**; TypeScript and production bundle passed.
- Revised implementation: **442 tests in 41 files passed**; TypeScript and production bundle passed at this checkpoint.
- Added regressions cover provenance, incomplete/deleted blocks, forms/keys/devices, silent timing, missing values, Wilson-count boundaries, first stable pitch vs later corrections, short/transient frames, pitch-boundary jitter, save identity, and evidence/source coverage.
- Existing tests that encoded the superseded scientific assumptions were deliberately replaced with tests for the revised contract. Passing tests are not evidence for the assumptions they formerly encoded.
- Isolated Chromium renderer: **16 checks passed** for navigation, readiness, source disclosures, sample labelling and page-width behavior at 390, 768 and 1440 px. A phone overflow found in Progress was corrected and retested. Screenshots were inspected.
- Renderer used a bundled preview with fake IndexedDB/transient storage and disabled microphone/accounts. Normal URL and local-file browser navigation were blocked by the environment's administrator policy. This is **not end-to-end live-site testing**. No bypass was attempted.
- Production/account API, deployment infrastructure, actual microphone quality, iPhone/Safari behavior and multi-device sync were not certified by this audit. The full API/deployment suite was not rerun locally.

The standalone preview is built with `node scripts/build-review.mjs output.html`; it is deliberately not the production app. It uses synthetic examples only when the preview's sample button is pressed. Its temporary data does not represent any person's performance.

## What remains open

**Real-voice instrument validation** is the most important gate. Use a comfortable voice, quiet room, headphones and a known microphone. Compare observed notes with an independent reference or knowledgeable human; include onset scoops, vibrato, breathiness, octave displacement, silence and modest noise. Assess failures, not only successful clear tones. Do not practice while driving.

**Broader outcomes** are not implemented merely by documenting them. Controlled lyric/guitar/accompaniment comparisons, imported-song phrase models, held-out transfer banks and verified correct-restart recovery remain future work. The check-in has three trials per module, so it cannot establish a diagnostic profile. Fixed-bank familiarity remains a confound.

**Physical range / higher belt** requires an appropriate technique strategy and potentially a teacher; an observed frequency span is not that goal. Persistent or concerning vocal changes warrant clinical advice. No app timer or self-rating certifies safety.

**Release discipline:** read [release validation](release-validation.md). This branch is an implemented evaluation candidate, not a production release. Preserve existing records and keep both protocol/scoring versions attached. Do not call the product validated until the relevant actual evidence exists.
