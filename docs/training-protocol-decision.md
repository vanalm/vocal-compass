# Decision record: the 8-week Vocal Compass training protocol

- **Status:** proposed (pending sign-off; on sign-off this is pushed to the goal tracker
  under the deep goal *Fluent musical self-expression (voice + guitar)*)
- **Date:** 2026-08-28
- **Deciders:** the maintainer, with literature synthesis by Claude (two research
  sweeps, 2026-08-28; ~29 primary sources)

## Decision

Follow an 8-week protocol: 2 weeks of app verification + KPI baselining,
then 6 weeks of distributed practice (4 sessions/week × ~15 min) across
Vocal Compass's five modules, with feedback **faded** over the phase
(live → commit-then-reveal → blind) and all KPI measurement taken on
blind trials. Weekly dated bullets with KPI targets live in the goal tracker; the
app's `KpiCalculator` is the measurement instrument.

## What the evidence says to expect in 8 weeks

- **Real, measurable improvement — with high individual variability.**
  Adult non-musicians improve singing accuracy significantly within 10
  weeks of regular practice, with or without feedback software (Paney &
  Tharp 2021; Leong & Cheng 2014). Single sessions of real-time visual
  feedback already move error measurably (Berglin, Pfordresher &
  Demorest 2022: ~20% relative error reduction in one 20-min session,
  d≈0.5 vs control).
- **Magnitude:** literature effect sizes are small-to-medium (d≈0.3–0.5);
  relative pitch-error reductions of ~20–50% are the realistic band. The
  protocol's "+20 pts destination accuracy vs baseline" W8 target sits
  inside that band. Melody/route tasks improve more readily than isolated
  single-pitch matching (Berglin 2022) — good news for Route replay and
  Silent map.
- **The documented failure mode is feedback dependence:** gains made with
  a live display partially evaporate when it is removed (Paney & Tharp
  2021; Blanco, Tassani & Ramirez 2021). This is why KPIs are measured
  blind and feedback is faded, not constant.
- **What will NOT happen in 8 weeks:** expert-level accuracy;
  full closure for the hardest passages/registers; and if a genuine
  perceptual deficit existed (congenital amusia, ~1.5% prevalence —
  Peretz & Vuvan 2017), progress would be slow and partial (Anderson et
  al. 2012). The overwhelmingly likely case is a trainable
  vocal-motor *mapping* deficit, not a perceptual one (Hutchins & Peretz
  2012), and adult inaccuracy tracks disuse, not fixed talent (Demorest
  & Pfordresher 2015 — college students score *below* 6th-graders).
- **Retention beyond the training period is genuinely unstudied** in
  adults; no study follows up past ~10 weeks. The W8 re-baseline plus
  continued play (the music-stack Studio pipeline) is our own retention
  design.

## Why this framework (reasoning → evidence)

1. **Distributed short sessions (4×/wk × 15 min).** Spacing beats massing
   (Donovan & Radosevich 1999 meta-analysis, d=0.46); overnight gaps
   drive consolidation in musicians specifically (Simmons 2012); practice
   *structure* beats practice volume (Duke et al. 2009). The exact
   15-min/4×wk dose is a design choice, not a validated prescription —
   stated honestly.
2. **Faded feedback, blind measurement.** The guidance hypothesis
   (Salmoni et al. 1984; Winstein & Schmidt 1990: 50% feedback beats 100%
   at retention; Schmidt & Bjork 1992) plus the singing-specific
   dependence findings above. But concurrent visual feedback demonstrably
   *accelerates early acquisition* in poor-pitch singers (Berglin 2022;
   Wilson et al. 2008 — novices benefit, skilled singers are hurt). The
   synthesis: start live, fade to commit-then-reveal, finish blind.
   **This amends the original draft plan, which started blind.**
3. **Imagine-before-sing (audiation) stays, as an adjunct.** Mental
   practice has a moderate meta-analytic effect (Driskell et al. 1994,
   d≈0.53) and combined mental+physical beats either alone in music
   (Ross 1985; Steenstrup et al. 2021) — but imagery *alone* did not beat
   no practice (Steenstrup), and Gordon's audiation framework has weak
   controlled-trial support. So: retention-delay trials ride along inside
   sung sessions, never replace them.
4. **Active production, self-administered.** Production training beats
   passive listening for auditory plasticity (Lappe et al. 2008), and
   pitch-accuracy training transfers in adults (Pfordresher & Demorest
   2021). The app's destination-vs-landing split (selection error ≠
   vocal-control error) matches the field's translation-deficit model of
   poor-pitch singing (Hutchins & Peretz 2012).

## Alternatives considered

- **Teacher-led voice lessons.** No credible RCT compares teacher-led
  lessons to app/self-training on pitch accuracy — a real evidence gap,
  not a win for either side. Rejected for now on cost/scheduling and
  because the deficit being trained (pitch mapping) is exactly what the
  app instruments; revisit if W5 KPIs stall.
- **Solfège / movable-do ear training.** Improves sight-singing accuracy,
  but system comparisons rest on dissertation-level evidence (Hung 2012
  found *fixed*-do superior, contested). Deferred; Tonal north covers the
  key-anchoring function inside the protocol.
- **Choir participation.** Evidence is for perception gains and is
  confounded by self-selection (Dubinsky et al. 2019; Demorest
  longitudinal). Complementary, not a substitute; no measurement loop.
- **Passive listening.** No evidence it improves production accuracy;
  active training beats it at the neural level (Lappe 2008). Rejected as
  a training modality (still fine as repertoire exposure).
- **Always-blind protocol (the original draft).** Purest for retention,
  but leaves the fastest early-acquisition lever (concurrent visual
  feedback for inaccurate singers) unused in the weeks it helps most.
  Superseded by the faded schedule.

## Evidence gaps we accept knowingly

(a) No singing study combines faded feedback with delayed retention
testing — our fade design extrapolates from motor learning. (b) The
15-min/4×wk dose is untested. (c) Multi-week adult literature is two
studies with modest Ns. (d) Long-term retention is unknown; our W8
re-baseline and continued Studio play are the mitigation.

## KPIs (all measured on blind trials, app-computed)

Baseline W2 → targets: destination accuracy +20 pts by W8; hint rate
−25% by W4; map-loss rate −50% and median latency <1.5 s by W5;
independent accuracy ≥70% by W6; residual <50 cents on correct targets
by W8; noisy-environment accuracy within 10 pts of quiet-room by W7.
Adjust relative to the actual W2 baseline, not aspiration.

## Deeper-goal chain

Protocol → **Fluent musical self-expression (voice + guitar)** → a deeper personal goal. The
music-stack Studio (play-along) is the transfer surface: trained
navigation skill gets spent on real songs weekly.

## Key references

Spacing/consolidation: Donovan & Radosevich 1999 (J Appl Psych 84:795);
Cepeda et al. 2006 (Psych Bull 132:354); Simmons 2012 (JRME 59:357);
Duke et al. 2009 (JRME 56:310). Feedback design: Salmoni et al. 1984
(Psych Bull 95:355); Winstein & Schmidt 1990 (JEP:LMC 16:677); Schmidt &
Bjork 1992 (Psych Sci 3:207); Blanco et al. 2021 (Front Psychol
12:684693); Berglin et al. 2022 (Psych Music 50, doi:
10.1177/03057356211026730); Wilson et al. 2008 (JIMS 2:157); Paney &
Tharp 2021 (Psych Music 49:360); Leong & Cheng 2014 (JCAL 30); Hoppe et
al. 2006 (JCAL 22:308). Mechanism/prevalence: Hutchins & Peretz 2012
(JEP:Gen 141:76); Pfordresher & Demorest 2021 (JRME 69); Peretz & Vuvan
2017 (EJHG 25:625); Anderson et al. 2012 (Ann NYAS 1252:345); Whiteford
& Oxenham 2018 (Cortex 103:164); Demorest & Pfordresher 2015 (Music
Perception 32:293); Pfordresher 2022 (Ann NYAS, lifespan). Mental
practice: Driskell et al. 1994 (J Appl Psych 79:481); Toth et al. 2020
(PSE 48:101672); Ross 1985 (JRME 33:221); Steenstrup et al. 2021 (Front
Psychol 12:757052). Production>listening: Lappe et al. 2008 (J Neurosci
28:9632).
