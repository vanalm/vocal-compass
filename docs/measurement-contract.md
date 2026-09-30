# Measurement contract — vc-checkin-2 / stable-center-2

**Purpose:** make the numbers inspectable without presenting an unvalidated instrument as a diagnostic.

## Observations, not hidden mental states

The classifier estimates the first locally stable acoustic segment. Default rules require at least three valid frames spanning 150 ms, no gap above 150 ms, standard deviation at most 45 cents and span at most 1.4 semitones inside a 350 ms candidate window. These are engineering choices pending real-voice validation, not biological thresholds. Large vibrato, glides, breathiness, octave errors and background sound can still cause failure. Never equate detector clarity with a calibrated probability of correctness.

An earlier stable wrong note is preserved even if a later note is correct. Search indicators require distinct sustained centers rather than counting each rounded vibrato fluctuation. The acoustic record and optional user explanation are separate. An accurate note with an uncertain intention is still an acoustic hit, not proof that the target was internally available.

Voice-onset latency is the time to first accepted voiced frame after the go signal. It is affected by the device, capture pipeline, breath preparation and task. It is **not** selection speed or a measure of thought. A lost-to-first-sound interval is not a verified recovery; the old recovery metric is withheld until a linked correct-restart protocol exists.

## Check-in collection

Fifteen fixed items, three per module: immediate echo, learned route, tonal location, a two-second silent echo, and constrained major-scale pattern continuation. The current continuation task is not a missing note from a modeled song. A/B are deterministic item sets, **not validated equivalent alternate forms**. The home note is user-selected within the supported configuration; the entire task span is shown before consent. No maximum-range test is required.

Microphone permission and audio initialization are resolved before the model. The retention delay is recorded. Each captured first attempt is automatically saved, including unscored input. There is no score-based retry and no pitch/result display during the block. Save retries reuse a stable record ID. Leaving early produces an incomplete block rather than a completed favorable subset. Deleting any check-in item makes that block incomplete.

A comparable block requires all 15 unique item indices, current protocol and scoring versions, the actual expected item definitions, blind feedback, no hints or cue replays, known and consistent microphone/filter context, and first-take provenance. Silent items also require recorded timing within 250 ms of the planned delay; this tolerance is an engineering exclusion rule, not a perceptual threshold. All records remain inspectable even when excluded from comparison.

## Comparison and denominators

Compare completed blocks only when item set, home note, actual tasks, versions, microphone identity and filter match. Compare the earliest matching complete block with the latest complete block on a different local calendar day. Historical records without provenance remain in the legacy view, not silently upgraded.

**First-note hit rate:** matched acoustic destinations / scorable attempts. Report numerator and denominator. Unscored captures are not counted as vocal failures; show scorable/saved coverage beside the rate so missing input cannot disappear. Low or changing coverage undermines interpretation.

**Matched-note intonation:** median absolute target error among acoustically matched notes. No matches means missing, never zero-cent error. This is a conditional statistic whose note composition can change; it is not an independent proof of improved technique.

**Support:** separately display hint level, cue replays and feedback mode. A live display is support even without a clicked hint. Unsupported-hit yield in compatibility summaries uses all scorable attempts as its denominator and is not called independent-test accuracy.

**Uncertainty:** display Wilson 95% binomial intervals for hit counts. For k hits in n attempts: p=k/n, z=1.959963984540054, denominator=1+z²/n, center=(p+z²/(2n))/denominator, half-width=z×sqrt(p(1−p)/n+z²/(4n²))/denominator. Clamp endpoints to [0,1]. n=0 produces null. These are descriptive summaries under a simple binomial model; tasks differ, trials can be correlated and detector errors are not calibrated. They are not a significance test, a correction for multiple comparisons or a measurement-error bound. No “change is real” badge is produced.

Practice/legacy filters produce descriptive summaries only. They are not substituted for matched longitudinal comparisons. The chart has dated check-in points and uncertainty bars; spacing follows sequence, not elapsed duration, and a table provides values.

## Data and compatibility

New provenance fields are additive inside trial records; existing IndexedDB stores and sync record kinds are preserved. No destructive migration or historical re-scoring is performed. Current tests cover JSON/storage/sync behavior in local test environments; real multi-device/server integration must still be checked before release. The app warns if only in-memory storage is available.

Personal goal wording lives in localStorage on the device, separately from exported trial JSON and account sync. Raw audio is not stored by these paths; contours, input levels and metadata are. Optional accounts and existing error reporting remain separate network behavior. Do not claim all app activity is network-free.

## Interpretation limits

Three observations per module cannot diagnose a bottleneck. Repeated fixed items become familiar; matched improvement does not establish novel transfer. Self-training has no randomized counterfactual, so even repeated favorable change does not prove the app caused it. More consistent capture, additional days, held-out musical material and qualified human feedback are the next evidence—not a stronger adjective.
