# Koswork / Coscode: durable partial output and bounded execution

## Result

The existing Work and Code coordinators now save a bounded prefix of the latest
model text as `output_checkpoint` in their existing parent JSON state. No database
migration, new executor, UI change or production activation is included.

- `kind: unvalidated_model_output` explicitly distinguishes this text from a
  validated plan, artifact, reviewed patch or permission to publish.
- The prefix is at most 32,768 UTF-8 bytes, without splitting a character.
  `received_bytes` records the full accepted text size; `truncated` reports the cap.
- The first delta saves immediately. Later saves happen on the next delta after
  one second, or after 8,192 additional bytes. Completion, explicit cancellation,
  deadline and normal model cleanup attempt a final flush.
- `stream_completed` describes transport completion only. Parsing, validation,
  review, policy gates and publication still use the original full result path.
- Parent state is re-read before each write. Terminal state, a different child
  run, a missing parent or an owner privacy fence rejects late recovery writes.
- Checkpoint failures are best effort and cannot skip the canonical accounting
  cleanup. The next flush can retry a failed metadata save; it never retries AI.

The existing owner-scoped Work/Code responses expose the optional field. Existing
validated plans, drafts, patches and published files retain their own fields.
Starting a new child replaces the previous raw checkpoint. There is no automatic
injection of recovery text into prompts, execution, artifact import or publication.

## Lifetime, cancellation and accounting

Child `runs` creation and its reference in Work/Code parent state now commit in
one SQLite transaction. A failed parent update rolls back the child insert.

Work gains an overall active-execution deadline: default 600,000 ms, dependency
override `operationTimeoutMs`, integer range 1..1,800,000 ms. It covers an active
execution interval; owner approval and paused time outside that interval do not
consume it. Code retains its existing equivalent deadline. `TASK_TIME_BUDGET`
survives late transport cleanup and is not replaced by a generic interruption.

Cancellation aborts the transport and saves already accepted text before setting
terminal state. Repeating cancellation of a terminal Code run preserves its state
and version. Watchdogs abort safely if the parent disappears. Catch handlers do
not recreate deleted/fenced parent state.

An adapter that ignores abort can still occupy the active execution slot until
its transport settles. Neither cancellation nor a timeout proves the provider
stopped billing. Unknown dispatched requests retain conservative reservations;
the existing canonical ledger and owner-budget settlement remain authoritative.
No paid requests, credentials or provider settings are changed by this block.

## Restart boundary and limits

Production startup already closes interrupted child runs before recovering Work
and Code parents. Saved prefixes survive reopening SQLite. Interrupted in-flight
tasks fail (`RECOVERY_REQUIRED` for Work, `INTERRUPTED` for Code) without dispatch
or publication; repeated recovery is idempotent. Existing reconciliation for a
publication with uncertain remote outcome remains mandatory.

This is partial text recovery, not resumable provider generation. An abrupt crash
can lose the throttled, unflushed tail. No timer writes during a silent stream.
The checkpoint stores the latest model text only; partial tool-call arguments
are not exposed by the current gateway and are not captured here. Checkpoint
writes increment parent versions, so clients must use current versions for CAS
controls. The existing single-API-process execution model remains; this change
does not introduce cross-worker leases or distributed idempotency.

## Validation

- Real SQLite rollback on parent-link failure for both coordinators.
- File-backed SQLite close/reopen, startup recovery, owner scope, repeated recovery,
  no duplicate child rows and no artifact publication from partial JSON.
- Streaming cancellation, buffered-tail flush, late output rejection, same-request
  replay without another provider call, and conservative usage accounting.
- Stalled transport timeout, retained active slot, privacy fence, deleted parent,
  UTF-8 cap, write throttling and a refused checkpoint write.
- Local deterministic transports only; production VPS and Windows acceptance are
  deferred by the owner. Visual follow-up is recorded separately.
