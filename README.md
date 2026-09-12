# Vocal Compass

A local-first melodic navigation trainer. Most pitch apps ask one question —
how far was the sung pitch from the expected frequency? Vocal Compass asks two
independent ones: **which musical destination did you select**, and **how well
did your voice land on that selected destination?** A clean landing on the
wrong note is a selection error, not a vocal-control error, and they are
trained differently.

Everything runs in the browser. Trials and range measurements persist to
IndexedDB and export as JSON from the Progress screen. Accounts are
optional: a small FastAPI + SQLAlchemy server (`server/`) adds magic-code
sign-in and multi-device sync — local data stays the source of truth and
sync is a union merge of immutable records.

```bash
cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8799   # dev server echoes sign-in codes
```

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
| `pitch/NoiseFloorTracker.ts` | Adaptive voicing gate: low-percentile rolling floor of unvoiced frames; equals the old fixed gate in quiet rooms, flags `tooNoisy` when singing can't be separated | Pass custom `NoiseFloorOptions` |
| `pitch/PitchPipeline.ts` | The per-tick path (detector → noise gate → smoother); pure, so the gating truth table is unit-tested with a stubbed detector | Inject detector/smoother/tracker |
| `pitch/MicrophoneEngine.ts` | getUserMedia/AudioContext lifecycle with a configurable low-cut filter (default 60 Hz, set in Settings); delegates every tick to the injected pipeline | — |
| `pitch/micFilter.ts` | Low-cut options and their trade-offs, plus the advice that flags when range results point at the filter rather than the voice | Add an option |
| `audio/CuePlayer.ts` | Web Audio cue synthesis (notes, sequences, cadences) | — |
| `storage/TrialRepository.ts` | Persistence seam: IndexedDB in the browser, memory in tests; stores trials + range measurements | Implement `TrialRepository` |
| `pitch/RangeAnalyzer.ts` | Range from a siren sweep: only pitch held ≥3 continuous frames counts — cracks are not range | Pass custom options |
| `kpi/practiceTime.ts` | Practice minutes derived by clustering record timestamps; no session bookkeeping | — |
| `kpi/pitchZones.ts` | Register heat map data: destination accuracy per 3-semitone zone | — |
| `sync/SyncClient.ts` | Union-merge sync against `server/`; token in localStorage; 401 signs out | — |
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
  data. The noise gate adapts to loud environments (and warns when they are
  too loud), but pitch accuracy while singing over noise still depends on
  mic proximity — cars and streets want a headset mic.
- Range training is measurement + aiming (probe, heat map, edge-biased
  targets), not technique instruction — the app cannot hear strain, so the
  effort self-rating gates any range ladder.
- The sync server ships with dev-mode code echoing and no mailer; wire one
  up and set `VC_ECHO_CODES=0` before exposing it beyond localhost.
- Not yet built: song import (Phrase GPS), load ladder automation.
