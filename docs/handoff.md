# Handoff — Vocal Compass

Local-first singing trainer: measure pitch and range, train with feedback,
verify change against your own baseline. Vite + React + TypeScript; optional
FastAPI + SQLAlchemy sync server in `server/`.

## Run it

```bash
npm run dev                      # app on http://localhost:5199
npm test && npm run build        # vitest + type-check/bundle
cd server && .venv/bin/python -m pytest -q
cd server && VC_DB_URL="sqlite:///$PWD/dev.db" .venv/bin/uvicorn app:app --port 8799
```

The sync server does not hot-reload: restart it after changing `server/app.py`.

## State right now (2026-09-12)

- `main` at `56bb59b`, **25 commits ahead of origin, nothing pushed**.
- **Uncommitted work in the tree belongs to another Claude session** (Test/Lab
  walkthrough: `ExerciseInfo.tsx`, `CuePlayer.stop()`, `useTrialRunner`
  `options.flow`, exercise guides). Don't commit or revert it. It also holds
  unstaged hunks in `src/core/index.ts` and `src/styles.css`.
- Suites green at `56bb59b`, verified alone in a clean worktree.

## Recently shipped

| Commit | What |
|---|---|
| `56bb59b` | Settings screen; mic low-cut filter (Off / 60 default / 80 / 100); filter recorded per range measurement; range summary suggests a switch when results point at the filter |
| `7c41927` | Range walk as turn-taking: listen → pause → sing → result → next; keyboard strip, per-note feedback, coaching tips, summary insights |
| `7c924f7` | Phrase format (degrees + rhythm + Nashville chords) and Echo Quest |
| `8734862` | Productionization plan (GCP, the goal tracker stack) — plan only, nothing built |

## Open items, in priority order

1. **Don't expose the sync server publicly.** Sign-in codes are echoed in
   responses (`VC_ECHO_CODES` defaults on), `/auth/verify` has no rate limit,
   and session tokens are stored in plaintext. Phase 1 of
   `docs/productionization-plan.md` fixes all three (~half a day).
2. **Real-voice checks.** Every mic feature was verified with a synthetic
   singer, not a person. The low-note filter advice in particular is
   unconfirmed on a real deep voice: in valid tests the old 80 Hz filter
   never cost a note down to C2.
3. **After the other session commits:** switch `useTrialRunner.ts` to import
   from `src/ui/hooks/flowMode.ts`. Keep its `options.flow ?? loadFlowMode()`
   initializer and the `setFlowMode` return shape.
4. The Lab/Test "too noisy" warnings could suggest the Noisy filter, like the
   range summary does (those screens belong to the other session's work).
5. Productionization decisions for the user: infra split, domain, WorkOS
   tenant, open vs allowlisted signup, migrating local data
   (`docs/productionization-plan.md` §13).
6. Next feature per `docs/vocal-musicianship-roadmap.md`: Run Forge (tempo
   staircase over the phrase format).

The 8-week pitch block lives in the goal tracker (goal ids →
goal ids). The final edge into goal ids would not
create; the goal tracker's `add_task` returned null three times.

## Gotchas learned the hard way

- **The preview browser blocks the microphone.** Test mic flows with a
  synthetic singer (paste into the page console). Return a *fresh* stream on
  every `getUserMedia` call: the app stops tracks on `stop()`, and a reused
  stream silently turns every later run into silence.

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

- **The shell is zsh.** An unquoted `$VAR` holding several paths is *not*
  split, and `set -e` did not stop a failing script in this tool. List paths
  literally and check each step explicitly.
- **Two sessions share this tree.** For a shared file, stage "HEAD + your
  hunks only" (`git hash-object -w --stdin` + `git update-index --cacheinfo`),
  then build and test the commit alone in a `git worktree` before trusting
  it.

## Read next

`README.md` (architecture) · `docs/training-protocol-decision.md` (8-week
protocol + evidence) · `docs/range-training-evidence.md` (range method,
safety) · `docs/vocal-musicianship-roadmap.md` · `docs/productionization-plan.md`
