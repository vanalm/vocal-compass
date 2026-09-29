# Vocal Compass

A local-first melodic navigation practice tool. It separates the **first stable
observed note**, **intonation around that note**, **support used**, and the
singer's optional explanation. A pitch tracker does not know intention, register,
strain or overall musical quality.

The September 2026 audit adds Today / Practice / Progress / Guide, inspectable
check-ins, an in-app research library and explicit alternatives/limitations.
This is an **evaluation candidate, not a validated training intervention**.
See [the deep audit](docs/science-audit.md) and
[open release gates](docs/release-validation.md).

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
| `trial/trialSummary.ts` | The per-trial dashboard's numbers: each note sung and how far off its center, pitch and volume steadiness, time to first sound, voiced share | — |
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
| `kpi/practiceTime.ts` | Legacy estimated-duration helper, not a measured practice stopwatch | — |
| `kpi/pitchZones.ts` | Register heat map data: destination accuracy per 3-semitone zone | — |
| `kpi/KpiCalculator.ts` | Descriptive compatibility summaries; matched check-ins live in `measurement/checkins.ts` | — |
| `recommend/Recommender.ts` | Picks today's session from the largest deficit, with a plain-language reason | — |

`src/ui` is a thin React layer: `services.tsx` is the composition root
(construct once, inject via context), hooks sequence each surface around a core
object (`useTrialRunner`, `useRangeWalk`, `usePhraseRunner`, `useAccount`), and
screens render state.

## Scope and honest limitations

- Five pitch modules (Direct echo, Route replay, Silent map, Tonal north,
  Pattern completion), a guided range walk, and phrase practice.
- Live or after-trial practice feedback. Versioned check-ins hide online pitch
  and withhold results until the block ends; all captured first attempts are kept.
- Optional intent confirmation in practice; check-ins do not invent self-reports.
  Unscored input stays missing, with capture coverage shown.
- The MPM detector plus smoother has synthetic regression coverage; validate across
  devices, rooms and registers before trusting fine-grained cents data. The
  noise gate adapts to loud rooms and offers the rumble filter, but singing
  over noise still wants a close mic. Every mic feature so far was tested with
  a synthetic singer, not a real voice.
- Range is an observation, not a certified usable range or higher belt. Readiness
  is checked before singing; optional exploration is not the original VFE protocol.
- Not yet built: Run Forge (a tempo staircase over phrases), song import, load
  ladder automation.

## Docs

`docs/training-protocol-decision.md` (the 8-week protocol and its evidence) ·
`docs/range-training-evidence.md` · `docs/vocal-musicianship-roadmap.md` ·
`docs/productionization-plan.md` · `docs/handoff.md` (state for the next session)

## Measurement and documentation

The primary progress comparison uses complete `vc-checkin-2` blocks with
`stable-center-2` scoring, matching item set/home note/device/filter on different
days. Legacy and mixed practice records remain inspectable but are not silently
upgraded. Fifteen attempts are a preliminary snapshot, not a diagnosis. Read
[the measurement contract](docs/measurement-contract.md) for denominators,
uncertainty, missing values, device limitations and versioning.

The Guide uses `src/core/science/evidence.ts` for study-level findings, limits,
access depth, review dates and DOI/PubMed links. The eight-week horizon and
session cadence are planning choices, not prescriptions or promised gains.

## Isolated visual preview

```bash
node scripts/build-review.mjs vocal-compass-review.html
```

This produces a self-contained design preview with temporary mock storage,
disabled microphone/accounts and an explicit fabricated-sample switch. It is
not a practice client, deployment or substitute for the real-device checks.
It is never imported by the production entrypoint. Personal goal wording stays
on the device and is not currently part of trial JSON export/account sync.
