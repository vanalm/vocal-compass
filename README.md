# Vocal Compass

A local-first melodic navigation trainer. Most pitch apps ask one question —
how far was the sung pitch from the expected frequency? Vocal Compass asks two
independent ones: **which musical destination did you select**, and **how well
did your voice land on that selected destination?** A clean landing on the
wrong note is a selection error, not a vocal-control error, and they are
trained differently.

Everything runs in the browser. Trials persist to IndexedDB; no account, no
upload. Data exports as JSON from the Progress screen.

## Run it

```bash
npm install
npm run dev
```

Serve over `localhost` or HTTPS so the microphone permission works, and use
headphones so synthesized cues do not leak into pitch detection.

```bash
npm test        # 28 unit tests: classifier, state machine, KPIs, exercises, storage
npm run build   # type-check + production bundle
```

## Architecture

The core (`src/core`) is framework-agnostic TypeScript — no React imports, no
DOM assumptions — and every seam is an interface or abstract class:

| Piece | Role | Extend by |
|---|---|---|
| `exercises/Exercise.ts` | Abstract training module: trial generation + cue plan + default feedback policy | Subclass + one `register()` call in `registry.ts` |
| `trial/TrialSession.ts` | State machine for one attempt (listen → imagine → sing → review); owns timing, trace, rescue | — |
| `trial/AttemptClassifier.ts` | Separates destination selection from landing; injectable thresholds for device calibration | Pass custom `ClassifierThresholds` |
| `trial/RescueLadder.ts` | Graded "I'm lost" hints; records the minimum support needed | — |
| `pitch/PitchDetector.ts` | Estimator seam; shipped default is `MpmDetector` (McLeod, via pitchy), with the dependency-free `AutocorrelationDetector` as fallback | Implement `PitchDetector` |
| `pitch/PitchSmoother.ts` | Streaming spike suppressor: clarity gate + one-frame confirmation for large jumps; never bends values, so real octave leaps survive | Pass custom `SmootherOptions` |
| `pitch/MicrophoneEngine.ts` | getUserMedia/AudioContext lifecycle with an 80Hz high-pass; emits `{raw, smoothed}` frames; detector and smoother injected | — |
| `audio/CuePlayer.ts` | Web Audio cue synthesis (notes, sequences, cadences) | — |
| `storage/TrialRepository.ts` | Persistence seam: IndexedDB in the browser, memory in tests, sync later | Implement `TrialRepository` |
| `kpi/KpiCalculator.ts` | KPI engine — deliberately never one "singing score" | — |
| `recommend/Recommender.ts` | Picks today's session from the largest deficit, with a plain-language reason | — |

`src/ui` is a thin React layer: `services.tsx` is the composition root
(construct once, inject via context), `useTrialRunner` sequences cues, delay,
capture, and rescue around a `TrialSession`, and four screens (Today, Lab,
Progress, Protocol) render state.

## v1 scope and honest limitations

- Five modules: Direct echo, Route replay, Silent map, Tonal north, Missing note.
- Blind / commit-then-reveal / live feedback modes; live pitch is hidden by
  default so the destination forms internally before the voice moves.
- Intent confirmation on ambiguous trials — the app never pretends a pitch
  tracker can read intention.
- Unscored beats mis-scored: low-confidence audio is flagged for retry.
- The MPM detector plus smoother is solid for note-level work; validate
  across devices, rooms, and registers before trusting fine-grained cents
  data. Noisy environments (cars, streets) still need a close mic.
- Not yet built: song import (Phrase GPS), load ladder automation, register
  heat map, account sync.
