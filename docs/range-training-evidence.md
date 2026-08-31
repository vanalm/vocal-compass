# Range measurement & training: what the evidence supports

Literature synthesis, 2026-08-28 (~59 sources reviewed; key citations below).
This doc is the authority behind `src/core/protocol/rangePlan.ts` — change the
code and this file together.

## Measurement

- **Repeat measurements drift up ~1.4 st with no training at all** (Printz
  2018, J Voice 32:32 — healthy adults, dual-mic voice range profile,
  test-retest). Practice/familiarity, not vocal change.
- **No published minimal-detectable-change exists.** Our ~3 st threshold is
  inferred: retest drift (~1.4 st) vs the ~4±5 st gained by surgically
  removing a vocal-fold lesion (Salmen 2017, J Voice 31:114). Sub-3 st
  "gains" are reported as within noise. `MEANINGFUL_RANGE_CHANGE_ST`.
- Discrete half-steps elicit better extremes than glissando (Barrett 2020,
  J Voice 34:179, n=56) and ~10 trials with coaching saturate the measurement
  (Ma & Li 2017). The probe implements this: tone-guided discrete semitone
  steps (`RangeWalk`), anchor → floor → ceiling, a step counting only when
  matched and held. (The original glissando probe is superseded; pre-existing
  measurements used it — expect a one-time apparent jump when comparing across
  the method change.)
- A phone cannot do a true voice range profile (frequency × calibrated dB);
  we honestly report semitones only. Same device + same method across
  measurements is the policy that matters (Printz 2017, JSLHR 60:3369).

## Training — what actually has evidence

- **Vocal Function Exercises (Stemple) are the program.** Stemple 1994
  (RCT vs placebo + control, 4 weeks: frequency range improved); Guzman 2020
  (JSLHR 63:1044, RCT n=40 graduate opera students, 10 weeks: voice-range-
  profile area expanded vs hygiene-only). Systematic review: Angadi 2019
  (J Voice 33:124, effects −0.59 to 1.55, no adverse outcomes in 21 studies).
- **Dose:** twice daily, ~6 weeks, no observed toxicity; once daily was
  insufficient (Bane 2019, IJSLP 21:37). Gains appeared by week 4 (Stemple).
- **The semi-occluded posture is load-bearing:** VFE on open vowels lost the
  effect (Bane 2019b, IJSLP 21:175). Lip/tongue trills produce the lowest
  vocal-fold contact of any gesture (Guzman 2015, Folia Phoniatr 67:68) —
  hence every step here rides a trill.
- **SOVT alone (straw etc.) is NOT evidence for range expansion.** Physics
  says efficiency + reduced collision (Titze 2006), the best meta-analysis
  rates the clinical evidence "very low" with no superiority (Pozzali 2024),
  and acute effects wash out in ~5 minutes (Echternach 2021). Trills are our
  vehicle, not our engine.
- **No controlled trials exist** for sirens/glides as training, register-
  transition ("mix") training, messa di voce, or vocal cool-downs. The app
  does not claim them.
- Elite conservatory training *reshaped* rather than expanded the measured
  range map over 3 years — and singers' self-assessment contradicted their
  measurements (Pabon 2014, J Voice 28:36). Expect access/efficiency gains
  of a few semitones, not a new voice.

## Safety — structural, because software cannot hear strain

- No validated acoustic marker of strain exists; worse, self-judged effort is
  unreliable (listeners heard strain speakers didn't feel — Ford 2024).
  Guardrails are therefore structural: per-step time caps, soft-volume
  instruction, trills, and cadence.
- Load spikes read as worse voice 24–72 h later; ≥48 h rest before heavy load
  helps (Carroll 2006). Two hard days in a row is the risk pattern.
- **Losing the top of the range is on NIDCD's warning-sign list** — the app
  surfaces a meaningful range *loss* as a see-a-clinician signal, never as
  "practice harder".

## App-delivered training can work

RCT n=399 teachers: a voice-exercise app improved the Dysphonia Severity
Index (which embeds highest-F0) vs control in 46 days, at a realized dose of
only ~2.4 hours total (Hauck 2025, Digital Health 11). Phone-grade F0
measurement correlates r²≈0.8–0.98 with lab tools in non-severe voices
(Llico 2026, J Voice 40:87).
