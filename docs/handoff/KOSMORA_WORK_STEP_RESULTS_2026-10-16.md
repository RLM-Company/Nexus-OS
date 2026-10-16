# Work step cancellation and result packages — 16 October 2026

Stacked on PR #351 (`1efdf92ef843a352293ecb173adca2c74a1c2806`), preserving the earlier Skills/reuse/library changes.

## Cancel one step

`cancel_step` uses the existing control endpoint with graph version and node ID. It cancels only the selected nonterminal node and its canonical Manager child, stops this graph's automatic scheduling and preserves completed results, accepted Skills, attempts and project mode. Dependent nodes remain blocked; independent nodes can be run explicitly. Other plans are unaffected. Cancellation remains available during project pause or emergency stop, but respects archive and owner privacy fences.

The UI has a review step pinned to the displayed graph version and recovers a lost response by GET, never by an automatic second POST. Completed/failed nodes cannot be cancelled. Cancelled nodes cannot be revived by editing their inputs or by copying a pending status over them. A new independent plan copy remains the explicit rerun path.

Cancellation aborts the existing executor. Late provider results cannot publish artifacts; uncertain AccountStore holds remain counted. If the graph checkpoint fails after child cancellation, reconciliation observes the terminal child and stops scheduling. Archive now checks actual single-process executor drainage rather than treating a persisted uncertain inflight ID as a forever-running operation. Both the uncertainty marker and budget hold are preserved.

## ZIP results

`GET /api/v1/projects/:projectId/work-dags/:id/results.zip` downloads an inert ZIP32 archive using the existing bounded archive writer. It contains a readable Markdown report, a `kosmora.work-results.v1` manifest and exact published UTF-8 artifact bytes. Numeric step/file prefixes separate duplicate basenames; untrusted titles and IDs are not archive paths. The manifest records graph version, all step states, completeness, hashes, artifact versions, source model runs and Critic decisions. The report escapes untrusted Markdown/HTML titles.

Partial/empty/archived plans can be exported; unpublished drafts, personal Skill instructions, owner identity, permission grants and task goals are not added to metadata. Output files themselves retain their original content. Scope, publication, artifact identity, version, byte count and SHA-256 are verified before sending any response bytes. Existing 2 MB serialized result bound and a 4 MB final ZIP bound apply. The earlier JSON endpoint is unchanged. Reading/exporting never starts a model call.

## Verification

- Full backend/package run: **831 passed, four skipped**, 126 files (125 passed, one skipped).
- Web: all **65 tests passed**, 16 files. Total confirmed unit/integration tests: **896**.
- Seven new cancellation regressions cover unstarted/queued/paused/approval-wait/inflight states, late-provider/uncertain-budget behavior, scope/CAS/fences, reopen, checkpoint failure and edits. Fifteen ZIP tests cover central directory/CRC, exact Unicode bytes, duplicate names, provenance, deterministic output, partial results, unsafe names, corruption and size bounds. HTTP checks verify download headers, cross-owner/project refusal and complete rejection of corrupted exports.
- API/web TypeScript, dedicated e2e TypeScript, changed-source ESLint/Prettier, secret and whitespace checks passed. Contracts/API builds and Next webpack production build completed successfully; 19 routes generated.
- Independent Python `zipfile` opened an actual generated package and verified every CRC, manifest path, SHA-256 and byte-for-byte Unicode/CRLF content.
- Nine Playwright scenarios are discovered across the two affected Work files; two new scenarios cover reviewed cancellation, lost/stale responses, download and narrow viewport. Browser execution remains blocked by missing Chromium; prior installation returned a corrupt archive. No browser pass or visual QA is claimed.

No schema migration, new accounting system, paid/live model call, deployment or main merge. PR #351's hosted CI failed before any step ran (`steps: []`, `runner_id: 0`); local results above are independent evidence, not a hosted CI success.
