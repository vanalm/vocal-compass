# Vocal Compass

A local-first melodic navigation trainer. Most pitch apps ask one question —
how far was the sung pitch from the expected frequency? Vocal Compass asks two
independent ones: **which musical destination did you select**, and **how well
did your voice land on that selected destination?** A clean landing on the
wrong note is a selection error, not a vocal-control error, and they are
trained differently.

Practice runs in the browser and is saved on the device (IndexedDB), signed in
or not, online or not. An account is optional: sign in to back practice up and
sync it between devices, and what you practiced before signing in joins the
account. Signing in never gates practice.

## Run it

```bash
npm install
npm run dev            # http://localhost:5199
```

Serve over `localhost` or HTTPS so the microphone permission works, and use
headphones so synthesized cues do not leak into pitch detection.

Accounts and sync need the API beside Vite, which proxies `/api` to it.
Locally, "Sign in" signs you in as `dev@localhost` without a password:

```bash
python3.12 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements-dev.txt
npm run api            # FastAPI on :8799; creates and migrates server/dev.db
```

The production image against real Postgres, with the same development sign-in:

```bash
docker compose up --build   # http://localhost:8090
```

## Test

```bash
npm test && npm run build                      # unit tests, type-check, bundle
cd server && .venv/bin/python -m pytest -q     # API; the Postgres run is in server/README.md
```

CI (`.github/workflows/ci.yml`) runs both, the API suite on Postgres 16,
Terraform validation and tests, and an image build.

## Production

One container serves the SPA and `/api` on Cloud Run, backed by Cloud SQL
Postgres, with sign-in through WorkOS AuthKit. Logs are structured for Cloud
Logging, product events land in BigQuery, and each environment comes with
alerts, an uptime check and a dashboard. When CI passes on `main`, the image
deploys to staging and then, after approval, to production.

| Read | For |
|---|---|
| [`terraform/README.md`](terraform/README.md) | First deploy, WorkOS setup, day-2 operations, costs |
| [`server/README.md`](server/README.md) | API configuration, modules, adding a record kind |
| [`docs/productionization-plan.md`](docs/productionization-plan.md) | Why the stack looks the way it does |

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
| `pitch/NoiseFloorTracker.ts` | Adaptive voicing gate: low-percentile rolling floor of unvoiced frames; flags `tooNoisy` when singing can't be separated | Pass custom `NoiseFloorOptions` |
| `pitch/PitchPipeline.ts` | The per-tick path (detector → noise gate → smoother); pure, so the gating truth table is unit-tested with a stubbed detector | Inject detector/smoother/tracker |
| `pitch/MicrophoneEngine.ts` | getUserMedia/AudioContext lifecycle with a configurable low-cut filter (default 60 Hz, set in Settings) | — |
| `pitch/micFilter.ts` | Low-cut options and trade-offs, and the advice that suggests a change when results point at the filter or at rumble | Add an option |
| `pitch/RangeWalk.ts` | Guided range measurement as turns: listen, sing, result, next note | — |
| `pitch/RangeAnalyzer.ts` | Range from a siren sweep: only pitch held ≥3 continuous frames counts — cracks are not range | Pass custom options |
| `phrase/` | One phrase format (scale degrees, rhythm, Nashville chords) behind Echo Quest and future phrase games | Add a phrase to `library.ts` |
| `audio/CuePlayer.ts` | Web Audio cue synthesis (notes, sequences, cadences) | — |
| `storage/TrialRepository.ts` | Persistence seam: IndexedDB in the browser, memory in tests; deletions are tombstones | Implement `TrialRepository` |
| `sync/ApiClient.ts` | The one door to `server/`: same-origin requests carrying the HttpOnly session cookie; failures surface as typed errors (offline, signed out, retry later) | — |
| `sync/syncAccount.ts` | Pushes what this device hasn't sent and pulls what it hasn't seen, a page at a time, recorded in a per-account `SyncLedger` kept in IndexedDB | A new record kind: one entry in its `LOCAL` table |
| `sync/AccountSync.ts` | The account and its sync as one state machine: syncs after saves, on reconnect and on a stale tab, one run at a time | — |
| `kpi/practiceTime.ts` | Practice minutes derived by clustering record timestamps; no session bookkeeping | — |
| `kpi/pitchZones.ts` | Register heat map data: destination accuracy per 3-semitone zone | — |
| `kpi/KpiCalculator.ts` | KPI engine — deliberately never one "singing score" | — |
| `recommend/Recommender.ts` | Picks today's session from the largest deficit, with a plain-language reason | — |

`src/ui` is a thin React layer: `services.tsx` is the composition root
(construct once, inject via context), hooks sequence each surface around a core
object (`useTrialRunner`, `useRangeWalk`, `usePhraseRunner`, `useAccount`), and
screens render state.

## Scope and honest limitations

- Five pitch modules (Direct echo, Route replay, Silent map, Tonal north,
  Missing note), a guided range walk, and Echo Quest phrases.
- Blind / commit-then-reveal / live feedback; live pitch is hidden by default
  so the destination forms internally before the voice moves.
- Intent confirmation on ambiguous trials — the app never pretends a pitch
  tracker can read intention. Unscored beats mis-scored.
- The MPM detector plus smoother is solid for note-level work; validate across
  devices, rooms and registers before trusting fine-grained cents data. The
  noise gate adapts to loud rooms and offers the rumble filter, but singing
  over noise still wants a close mic. Every mic feature so far was tested with
  a synthetic singer, not a real voice.
- Range training is measurement and aiming, not technique instruction — the
  app cannot hear strain, so the effort self-rating gates any range ladder.
- Not yet built: Run Forge (a tempo staircase over phrases), song import, load
  ladder automation.

## Docs

`docs/training-protocol-decision.md` (the 8-week protocol and its evidence) ·
`docs/range-training-evidence.md` · `docs/vocal-musicianship-roadmap.md` ·
`docs/productionization-plan.md` · `docs/handoff.md` (state for the next session)
