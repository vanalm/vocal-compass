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

- The production stack is on `main` of the public `vanalm/vocal-compass`
  repository; commits use the GitHub noreply address.
- Green at the last run: web unit tests, the API suite on SQLite and on
  Postgres 16, `mypy --strict`, Terraform `validate` + `test` in every root,
  actionlint, and an image build with a compose smoke test (sign-in and a
  two-device sync round trip).
- **Google Cloud:** project `vocal-compass` exists with billing linked, and
  the Terraform bootstrap is applied (state bucket, registry with the first
  image, deploy identity, empty WorkOS API key secrets). Staging and prod are
  initialized against the bucket but not applied. The GitHub Environment
  `production` exists with a required reviewer; the repo variables are not
  set yet. `terraform/README.md` is the runbook.

## To go live, in order

1. **WorkOS:** in your WorkOS account, add a Vocal Compass project with
   staging and production environments, set each redirect and sign-out URL,
   and put the client IDs into `terraform/envs/*/*.auto.tfvars`. Add each
   environment's API key to Secret Manager (`terraform/README.md`, step 2).
2. **Apply** staging, then prod (`terraform/README.md`, step 4). Prod serves
   on its `run.app` URL until `domain` is set in `envs/prod/prod.auto.tfvars`,
   which adds the load balancer and needs a Cloudflare DNS-only A record.
3. **GitHub:** set the repo variables from the Terraform outputs
   (`terraform/README.md`, step 7). From then on, a push that passes CI
   deploys to staging and waits for your approval before prod.

## Open items, in priority order

1. Go live (above).
2. **Real-voice checks.** Every mic feature was verified with a synthetic
   singer. The low-note filter advice is unconfirmed on a real deep voice.
3. **Known, documented limits:** rate limits count per Cloud Run instance; a
   Cloud SQL point-in-time restore needs a sync generation marker before
   clients re-pull cleanly (`server/README.md`).
4. Next feature per `docs/vocal-musicianship-roadmap.md`: Run Forge (a tempo
   staircase over the phrase format).

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
- **Docker in headless sessions (agents, scripts):** if Docker Desktop's
  credential helper hangs, point `DOCKER_CONFIG` at a scratch directory holding
  `{"auths":{}}` and a symlink to `~/.docker/cli-plugins` (without it, BuildKit
  is missing).
- **Compose publishes on 8090**, not 8080, to stay clear of other local
  services that commonly hold 8080.
- **`WORKOS_COOKIE_PASSWORD` is a Fernet key** (32 random bytes, base64), not a
  password. Terraform generates it.
- **The console log in the preview browser survives reloads.** Count errors
  before an action and compare, or stale hot-reload errors look like new bugs.
- **Under zsh**, an unquoted `$VAR` holding several paths is not split.

## Read next

`README.md` · `terraform/README.md` · `server/README.md` ·
`docs/training-protocol-decision.md` · `docs/vocal-musicianship-roadmap.md` ·
`docs/productionization-plan.md`
