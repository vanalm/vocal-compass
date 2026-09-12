# Vocal Musicianship roadmap

The 2026-09-12 brainstorm, reconciled against what exists. The learning loop:
**hear → imitate → coordinate → recall → use musically → transfer → perform.**
Product promise: *practice freely, prove it cold, then use it musically.*

## The load-bearing decision

One reusable exercise format powers every game (`src/core/phrase/`):
a **Phrase** = scale-degree contour + rhythm + Nashville chord timeline.
Realized against a key, tempo, **singer role** (melody / root / third / fifth)
and **guide strength** (full / anchor / none), it yields concrete timed
targets that one scorer judges (`PhraseScorer`: per-note pitch, onset
timing, extras, landing). Echo Quest, Run Forge, Harmony Lock, Nashville
Navigator and Spotlight are skins over this format — content, not code.

Labeling convention (adopted from the brainstorm verbatim): `CHORD 6m` =
the Nashville chord · `SING K3` = the sung note's degree in the key ·
`ROLE CT3` = its job in the chord. Minor convention: tonic stays 1, chords
show quality (1m), notes show b3/b6/b7 — never silent relative-major
renumbering.

## Status

| Brainstorm concept | Status |
|---|---|
| Hear–Imagine–Sing loop, fading guidance, comfort ratings | Shipped long since (trial loop, feedback fade, confidence/effort) |
| Soundcheck / adaptive tessitura | Partial: keys adapt to the measured range (`pickTessituraTonic`); no daily readiness flow yet |
| Level 1 Find Home cells | **Shipped** — phrase library level 1 + existing modules |
| Level 2 Run Lab starter cells | **Shipped** — half-beat run phrases, rhythm-aware scoring |
| Level 3 Number Navigator (roles over progressions) | **Shipped** — chord-tone realization + pads; K/CT labels |
| Echo Quest with guide fade | **Shipped** — `phraseProgress` ladder: pass ≥80% fades full → anchor → none |
| Practice vs Verified | **Shipped** — `verified` = guide-free first take, never overwritten by retries |
| Keep / Fix / Retry review | **Shipped** — scorer emits one keep + one highest-impact fix |
| Count-in + onset timing KPI | **Shipped** — scored per note, mean abs onset ms stored |
| Run Forge (chunk assembly, tempo staircase) | Next: needs per-phrase bpm ladder + chunk looping UI over the same format |
| Harmony Lock / Duet Dropout | Planned: guide in headphones, mic hears only the singer; dropout = scheduled guide gaps; drift + re-entry metrics from existing pipeline |
| Rhythm-only echo | Planned: scorer already measures onsets; needs a rhythm-only mode (any pitch accepted) |
| Stack Your Choir / recordings | Planned: trace playback exists in concept (synth from trace); overdub mixing is new |
| Song Lab / Chart Karaoke | Planned: marry the music-stack Studio (chords-as-played, sections, lyrics) to phrase scoring — the transfer surface named in the goal tracker plan |
| Skill tree + mastery gating (2 days, 2 keys, 1 novel) | Planned: all inputs already persisted (key, phraseId, verified, createdAt) — it is a pure query |
| Rescue Drill auto-routing | Partial: fix-line heuristics exist; auto-inserting a 20s corrective loop is UI work |
| Error routing (late→subdivision, guided-only→recall, etc.) | Planned on top of stored per-note results |

## Build order (each independently shippable)

1. ~~Phrase format + scorer + library + Echo Quest + persistence~~ (done)
2. Run Forge: tempo staircase (bpm ladder per phrase, advance on clean reps), chunk/join looping, displaced-accent variants
3. Rhythm-only mode + subdivision drills (the brainstorm's error-routing target)
4. Harmony Lock: hold a role while the guide melody moves; dropout bars; attraction/drift metrics
5. Skill dashboard: per-skill Assisted→Performed states from verified records across ≥2 days and ≥2 keys
6. Spotlight: weekly cold check drawing unseen equivalents from the library (novel-item generation = transpose + re-rhythm existing cells)
7. Song Lab: music-stack `window.SONG` payload → phrase timeline → role missions over real songs

## Guardrails carried over

The app assesses audible pitch, rhythm and part adherence only. It does not
claim to hear breath support, strain, or vocal health (see
`range-training-evidence.md`). Reward ease, consistency and repair — never
loudness, ceiling notes, or streaks. Success target in practice is 75–85%:
perfect means fade support, repeated misses mean slow down or restore a cue.
