# Kosmora parallel delivery — 2026-10-08

Source baseline: b15912d, integration branch codex/brand-refresh-20261007, draft PR #320.
Owner requested exactly two new Work chats on GPT-6.1 Sol / high, ordinary Chat sessions on high for additional feature implementation, a separate competitive feature analysis, and continued implementation by the coordinator. Eight ChatGPT project conversations were created with the same tracked source ZIP (secret scan passed). Work mode and model/effort were checked in the UI; ordinary mode uses GPT-6 / high. This is a consolidation of earlier roadmap decisions and requests, rather than a claim that the exact historical 20+ list was recovered.

| Blocks   | Responsibility                                                                       | Conversation                         |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| 1–5      | Code agent, tool calls, isolated commands, multi-file diff, draft PR                 | 6ac7ed14-6540-83ed-aef5-054bf02b4880 |
| 6–10     | Durable Manager tasks, queue/checkpoints, project memory, Critic/artifacts, progress | 6ac7eddc-cfec-83eb-819c-01daffa1978e |
| 11–13    | Large document library, retrieval/citations, real document exports                   | 6ac7ee87-51b0-83ed-86b5-9b0faffe11b0 |
| 14–16    | Real image adapter, transcription, speech playback                                   | 6ac7ef49-3ca4-83eb-94f0-e657625e394f |
| 17–19    | Windows state/deep links, file operations, verified update handling                  | 6ac7ef4a-bfb8-83ed-a5ae-15fc6eb2a2ac |
| 20–22    | Settings, English relay disabled by default, usage/quotas/data                       | 6ac7ef4c-a328-83eb-8288-5cf20450d13f |
| 23–24    | Research workflow, sources/report export                                             | 6ac7ef4d-e798-83eb-9c33-ddb3cf1e53b2 |
| 25–26    | Coordinator: runtime maintenance, integration/release                                | Current local chat                   |
| Separate | Official-source comparison of ChatGPT/Claude/Gemini/Grok/Kimi                        | 6ac7ef5f-24f8-83ed-ae04-1ccb03e02b88 |

Every implementation brief requires actual code and an applicable patch/ZIP, scoped checks and honest limitations. Each worker edits its own copy; shared app.ts/schema/migrations/navigation/lockfiles need separate minimal integration patches. The intelligence graph remains owned by its existing separate effort. No credentials, production databases or browser sessions were shared. Project development authorization does not remove tool/platform permissions or product confirmations for expenses and publishing. Workers do not independently deploy to the VPS or merge main.

## Runtime maintenance implementation

deploy/alpha/maintenance.mjs performs read-only catalog renewal and stages a seven-day replacement for the existing authorized service identity, within 48 hours of expiry. It never changes the configured model, capabilities, roles, privacy declarations, prices or token limits. Discovery explicitly clears paid opt-in and checks that generation_requests is zero. It does not claim to re-test streaming or paid capabilities. Revoked/expired/disabled owner identities cannot be resurrected by the timer. Assurance is preserved.

The host wrapper serializes maintenance with flock, creates a verified online SQLite backup before switching, recreates only affected services, verifies external owner protection/access, then revokes the previous service bearer. A failed switch restores the previous files before revoking the candidate. A persisted pending transaction is recovered before another is prepared. The browser's 30-day cookie and its persistent store are independent and are not rotated by this job.

The systemd timer checks expiry hourly and creates a verified SQLite backup at least daily while it is running. Backups remain local on the VPS; off-site disaster recovery and backup retention are separate work. Node tests cover real SQLite session staging/commit/rollback, free-only discovery, unchanged capabilities/assurance, and denial of revoked identity/model changes. Windows sandbox blocked SQLite backup rename; the same tests passed outside that sandbox.

## Activation evidence — 2026-10-09 (Moscow date)

The automatic approval reviewer initially rejected production installation because explicit consent to scheduled session renewal/service recreation was missing. The owner then explicitly approved activation. No rejected action was performed before that approval.

- All 47 local deploy checks passed, including the six maintenance tests. The same six tests passed in the actual API image on isolated temporary SQLite data; production DB was not used by those tests. Shell syntax and systemd unit validation passed.
- Final sources were uploaded to /opt/cosmora/releases/maintenance-20261008/deploy/alpha; the configured host wrapper is /opt/cosmora/runtime/maintenance.sh.
- The first real run returned `Kosmora maintenance PASS; no generation requests.` It created the verified online backup. Neither current expiry was due, so API/proxy were not recreated and the existing bearer/catalog were retained.
- kosmora-maintenance.timer was enabled and started. An explicit service start returned `Result=success` and `ExecMainStatus=0`; list-timers showed the next hourly execution. Routine rotation will become due within 48 hours of the existing expiry.
- Rotation and rollback were checked on isolated databases, including interruption after the old bearer has been revoked. The durable committing phase prevents restoration of that revoked bearer. A production rotation is not claimed: it was not yet due.
