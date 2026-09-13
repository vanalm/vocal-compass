# Handoff — Vocal Compass

Local-first singing trainer: measure pitch and range, train with feedback,
verify change against your own baseline. Vite + React + TypeScript SPA, a
FastAPI API in `server/`, one Docker image, Terraform for Google Cloud, and
GitHub Actions for CI and deploys.

## Run it

```bash
npm run dev                    # app on http://localhost:5199, proxying /api to :8799
npm run api                    # API in development mode: dev sign-in, SQLite, migrates itself
npm test && npm run build      # vitest + type-check/bundle
cd server && .venv/bin/python -m pytest -q
docker compose up --build      # the production image + Postgres on http://localhost:8090
```

## State right now (2026-09-12)

- The production stack is committed on `main`; nothing is pushed, and
  **`vanalm/vocal-compass` is a public repo**, so pushing publishes all of it.
- Green at the last run: web unit tests, the API suite on SQLite and on
  Postgres 16, `mypy --strict`, Terraform `validate` + `test` in every root,
  actionlint, and an image build with a compose smoke test (sign-in and a
  two-device sync round trip).
- **Nothing exists in Google Cloud yet.** `terraform/README.md` is the runbook.

## To go live, in order

1. **WorkOS:** in the existing account (the one the goal tracker uses), add a Vocal Compass
   project with staging and production environments, set each redirect and
   sign-out URL, and put the client IDs into `terraform/envs/*/*.auto.tfvars`.
   This was blocked here: the browser was signed out of WorkOS.
2. **Project:** `gcloud projects create vocal-compass` and link billing. If the
   id is taken, choose a suffix and replace it in the three `*.auto.tfvars`.
3. **Values:** `domain` in `envs/prod/prod.auto.tfvars`; `alert_email` in each
   env's gitignored `terraform.tfvars` (never committed — the repo is public).
4. **Apply** per `terraform/README.md`: bootstrap → WorkOS API keys into Secret
   Manager → first image → staging, then prod → Cloudflare DNS-only A record →
   GitHub Environment `production` with reviewers, then the repo variables.

## Open items, in priority order

1. Go live (above).
2. **Real-voice checks.** Every mic feature was verified with a synthetic
   singer. The low-note filter advice is unconfirmed on a real deep voice.
3. **Known, documented limits:** rate limits count per Cloud Run instance; a
   Cloud SQL point-in-time restore needs a sync generation marker before
   clients re-pull cleanly (`server/README.md`).
4. Next feature per `docs/vocal-musicianship-roadmap.md`: Run Forge (a tempo
   staircase over the phrase format).

the goal tracker: the 8-week pitch block (goal ids → goal ids) now
links into goal ids. the goal tracker notes that goal has three incoming tasks,
which it reads as alternatives; fold them into one multi-origin task if all
three are required.

## Gotchas learned the hard way

- **The preview browser blocks the microphone.** Test mic flows with a
  synthetic singer (paste into the page console). Return a *fresh* stream on
  every `getUserMedia` call: the app stops tracks on `stop()`.

  ```js
  const ctx = new AudioContext();
  const osc = ctx.createOscillator(); osc.type = "triangle";
  const gain = ctx.createGain(); gain.gain.value = 0;
  osc.connect(gain); osc.start();
  navigator.mediaDevices.getUserMedia = async () => {
    const d = ctx.createMediaStreamDestination(); gain.connect(d); return d.stream;
  };
  setInterval(() => {                       // sing the range walk's target, on the singer's turn only
    const p = document.querySelector(".vc-range-probe");
    const sing = p?.dataset.phase === "sing";
    if (sing) osc.frequency.value = 440 * 2 ** ((Number(p.dataset.targetMidi) - 69) / 12);
    gain.gain.setTargetAtTime(sing ? 0.3 : 0, ctx.currentTime, 0.01);
  }, 25);
  ```

  For the too-noisy warning, loop a buffer of white noise into the stream
  instead.
- **Docker in agent sessions:** Docker Desktop's credential helper hangs. Point
  `DOCKER_CONFIG` at a scratch directory holding `{"auths":{}}` and a symlink
  to `~/.docker/cli-plugins` (without it, BuildKit is missing).
- **Port 8080 is taken locally** by the `another local service's` container; compose uses
  8090.
- **`WORKOS_COOKIE_PASSWORD` is a Fernet key** (32 random bytes, base64), not a
  password. Terraform generates it.
- **The console log in the preview browser survives reloads.** Count errors
  before an action and compare, or stale hot-reload errors look like new bugs.
- **The shell is zsh.** An unquoted `$VAR` holding several paths is not split.

## Read next

`README.md` · `terraform/README.md` · `server/README.md` ·
`docs/training-protocol-decision.md` · `docs/vocal-musicianship-roadmap.md` ·
`docs/productionization-plan.md`
