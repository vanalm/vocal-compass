# Release validation — open gates

This checklist is not a claim that the checks have been completed. Automated unit tests and an isolated renderer are insufficient to sign off a singing app's acoustic instrument.

## Completed in this audit

- [x] Original source and scientific-claim review, with superseding documentation.
- [x] Revised frontend unit tests and TypeScript/production build.
- [x] Versioned check-in collection and comparison contract.
- [x] Isolated Chromium layout/interaction checks at mobile/tablet/desktop widths.
- [x] Synthetic examples explicitly labelled and excluded from production entrypoint.

## Required before production approval

- [ ] Run full repository CI, including API tests, Postgres, infrastructure validation and image build; inspect results for the exact candidate commit.
- [ ] Real HTTPS browser: permission granted, denied, device removed, background/resume, navigation during every trial phase, duplicate clicks, save failure/retry, reload and deletion behavior.
- [ ] Quiet-room real-voice pilot with headphones: accurate observation of comfortable notes, no model bleed, correct octave, first stable note vs a later correction, vibrato, scoops, breathiness, weak input and unvoiced periods. Record the microphone and browser. Do not describe synthetic input as a real singer.
- [ ] A separate modest-noise/device pilot; do not encourage louder singing to beat the gate. Stop if the voice becomes uncomfortable. Do not operate the app while driving.
- [ ] Check-in A on two days with the same home note/device/filter: all 15 first attempts saved, scores hidden until end, timing provenance valid, scorable coverage shown. Incomplete/deleted/mismatched blocks do not enter comparison.
- [ ] Old browser records remain readable; export/import preserves added fields; partial saving and account sync cannot turn a block into a selected best-attempt set.
- [ ] Real account sign-in/sign-out, second-device sync, tombstones and failed-network behavior. No authentication or production data was changed in this audit.
- [ ] iPhone/Safari and desktop microphone lifecycle; keyboard-only navigation and a screen-reader pass. Check 200% zoom and larger text. Isolated renderer checks do not certify WCAG conformance.
- [ ] Listen to actual phrasing and ask whether it is comfortable/repeatable. An improved chart alone is insufficient for musical transfer.

## Release / rollback

Review and merge only after the relevant checks above. Deployment stays under the repository's existing approval process. This work does not authorize skipping production approval. Export a backup before a pilot; no destructive data migration is required. If rolled back, retain new fields and version labels: older code must not reinterpret new check-ins as validated legacy improvement.

## Scope deliberately not claimed

No clinical safety or efficacy validation; no promised high-belt gain; no optimal dose; no automatic register/strain diagnosis; no calibrated statistical significance; no held-out song transfer; no verified recovery-time metric. The source cards and maintenance contract are designed to prevent these gaps from silently turning into marketing claims.
