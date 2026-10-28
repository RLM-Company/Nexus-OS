# Relay and offline release preparation — 28 October 2026

Base: main `c3ee9b4dc0eba5e7273363614466c6b6c915d886` (PR407).
Incoming provenance: Gemini's [Relay patch](https://docs.google.com/document/d/1XSXPnIqts85VSPM-WubyNOIThhXGKmoeXaGjMmMWE4Q/edit)
and [handoff](https://docs.google.com/document/d/1ggAFGT9asBVRrHOHcU0BYa7jLGA7arhlA5qEG7LomBI/edit).
The incoming snapshot predates PR406/407 and was adapted rather than applied wholesale.

## Integrated behavior

- Main chat usage commits independently of the optional back-translation, in both
  the server-owned coordinator and the SSE execution path. A translation failure
  can fail the message without erasing the completed main provider attempt.
- Exact accounting replay is idempotent. Conflicting provider/model/counters/cost,
  invalid counters and unsafe totals are refused atomically. Parent metadata and
  the canonical usage row update in one transaction.
- Pre-dispatch canonical reservation failures release only their proven local
  hold. Dispatched unknown outcomes retain existing conservative accounting.
- Translator provider failures close the gateway iterator instead of continuing
  its retry loop. Verified translation counters settle even if the resulting text
  is truncated or loses a protected span; rejecting text is not a billing refund.
- Byte-sensitive protection includes nested inline JSON/arrays, API paths,
  commands and identifiers. Replacement metacharacters are restored literally.
  Ambiguous marker input and likely credentials are rejected before translation.
- `inspectRelayAttachment` remains a utility: live chat still refuses attachments
  with Relay, and no automatic attachment translation is activated. The ASCII
  language heuristic is not used to skip live translations.

Relay remains off by default. Existing turbo/profile/reasoning behavior is retained.
Unknown price still means a conservative token bound/hold, even when actual token
counters are saved; this block does not weaken the PR406 canonical-evidence policy.
No fictional tariff, free media route or zero-cost provider result is introduced.

## Rejected or rewritten incoming parts

The incoming benchmark used manually supplied latency, assumed tariffs and a
character heuristic while labelling fields as token/cost savings. It is not a
measurement and is not exposed as an account benchmark API. A real comparison
requires actual direct/relay trials, verified usage, prices and measured timings.

The global `Symbol.for` preparation marker was not copied: it did not bind cached
preparation to an owner, chat, run or current settings. No caching authority or
implicit paid replay is added. Old source-file replacements and transpiler/scanner
fallbacks unrelated to the locked runtime were not copied.

The incoming preactivation checker guessed a fixed migration list ending at 35
and inferred applied migrations from table names. The integrated checker instead
verifies the current journal/checksums and runs the real compiled migration engine
against a disposable copy of a verified backup. It rejects modified copies,
sidecars, aliased backups, unknown history, gaps and checksum mismatches. Legacy
bridges require separate explicit review; no source/backup upgrade is attempted.

## Validation and remaining boundary

Selected API tests cover both execution modes with successful, failed, truncated,
corrupt and unknown-price back-translation. Replayed event reads do not dispatch
another model call. Database tests cover exact/conflicting replay and rollback.
Protection tests exercise nested JSON and literal replacement tokens. Real offline
SQLite rehearsals cover current and three-migrations-older schemas, immutable
backup/copy bytes, hard links, sidecars and tampered migration history.

Full CI for the final PR/head is reported separately. All transports in these
checks are deterministic fixtures. No paid calls, production activation, Windows
changes, UI/sidebar/logo/CSS changes or credential updates are included.

The [delivery branch](https://github.com/RLM-Company/Nexus-OS/tree/google/windows-privacy-acceptance-20261028/google-delivery-20261028)
contains Windows/privacy snapshots. Windows is already adapted in PR405. Privacy
segmentation is reviewed separately to preserve the current adapter manifest,
accounting, startup behavior and new Work/Code recovery state. The separate media
handoff on Drive has no corresponding media source in that delivery directory.
