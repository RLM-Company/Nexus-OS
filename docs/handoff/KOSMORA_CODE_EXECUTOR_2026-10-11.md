# Kosmora Code executor — 11 October 2026

The read-only OCI snapshot loader is corrected and verified against the real Docker daemon
on the Kosmora VPS. This delivery does not implement arbitrary shell execution or dependency
installation: checks remain the existing `node-test` and `syntax` operations.

## Implementation

Each job explicitly creates a labelled daemon-managed snapshot volume. A separate bounded,
network-isolated, read-only-rootfs loader runs only the operator's `tar` command, with no
capabilities and no repository execution. The loader ignores archived ownership. Archive
directories are 0755 so population needs no DAC override; file content remains 0444.

Only after successful loading is the checker created: UID/GID 65534, read-only snapshot mount,
read-only rootfs, no network, no capabilities, no-new-privileges, no daemon socket, and bounded
memory/CPU/PIDs/output/deadline. A writable `/tmp` permits scratch output. Snapshot digest and
the existing check/publication approval contracts remain unchanged.

Completion, cancellation, timeout, failed loading and output overflow remove both containers
and the snapshot volume. Successful daemon queries prove their absence; a failed removal is
not interpreted as absence. An unverified cleanup quarantines the runner. Startup also removes
labelled orphan containers and snapshot volumes before the sidecar listens. No global prune
is used. Temporary volumes use the daemon's local storage; they are not claimed as RAM-only.

The trusted executor service requires Docker daemon access; neither API nor repository job
containers receive that socket. Its private HTTP interface accepts only the existing validated
check types, files and digest, with a dedicated service token. This is ordinary container
isolation, not a separate VM/kernel boundary. Podman has not been checked in this pass.

## Evidence

- Windows full tool-runtime suite: **63 passed, 4 actual OCI cases skipped** (no local daemon).
  Native loopback/Git/tar/child-process tests passed outside the sandbox; the initial sandbox
  attempt failed due loopback/file-operation restrictions, not a successful gate.
- VPS targeted suite: **33/33 passed** in one run, including all four actual OCI cases.
  These execute the bug/fix, verify non-root/read-only/no-socket/no-network, preserve Unicode
  paths/content, and enforce timeout with descendant cleanup.
- Separate real HTTP + OCI smoke: **PASS** for bug/fix, isolation/no secrets, timeout,
  cancellation, output cap/redaction and absence of both containers and snapshot volumes.
- Code API/proposal regression: **36/36 passed** with the existing local model/GitHub fixtures.
- Tool-runtime TypeScript/package lint, deployment-script ESLint, formatting, diff checks
  and secret scan passed. The server rebuilt tool-runtime without network access.

The first VPS full-package attempt failed: the old archive's 0555 directory modes required
write capabilities during extraction, the archive fixture tried restoring foreign ownership,
and the slim verification image lacked Git. The archive/fixture defects are fixed. The final
VPS pass intentionally runs the 33 executor cases; the full Git-backed suite was verified on
Windows. No test was turned into a skip to obtain the server result.

Pinned check image: `sha256:f50289dfadc6812cdcf7fbb2ac2d9ad515a1e5c319eba9638b1389c94d2f2ac0`.
Verified executor image: `kosmora-code-runtime:verify-20261011`.
VPS material: `/opt/cosmora/releases/code-runtime-20261011`; source archive/checksum,
`Dockerfile.verify`, `verify.sh`, `unit-and-oci.log`, `http-oci.log`, and exact production
container identities before/after verification. Local material is under
`2026-10-11/kosmora-code-runtime` outside the checkout.

## Activation boundary

The isolated verification did not restart API/web/login. Activation is prepared separately
in `activate.sh`: reject active work, start the private executor, stop API, verify a consistent
SQLite backup, attach only executor URL/token/network to the existing API image, restart it,
run one synthetic check through API's real executor client, validate existing authenticated
read routes/schema, and prove web/login IDs and start times are unchanged. No migrations,
paid model calls, GitHub writes or user test chats are required. Failure restores the previous
deployment wrapper/API configuration and stops the new executor.

Do not infer activation from these tests. The result of the separate activation is recorded
below only after the server confirms it.

## Approval history

Feature commit: `150bb46bce16572bb6f7791318a27e35cc9646ef` on the local integration
branch. No GitHub push/PR is claimed. The source archive used for
the successful VPS verification differs only by a subsequent explanatory startup comment.

Automatic approval review initially rejected the
attempt to run `sh /opt/cosmora/releases/code-runtime-20261011/activate.sh` before it connected
or executed. Its stated reason: continued development authorization does not cover this exact
security-sensitive deployment creating a persistent Docker-socket-backed service, writing a
service token, changing deployment configuration and stopping/restarting live API. Do not
retry or execute it indirectly without that approval.

The user subsequently explicitly approved: “Да, подключить исполнитель Code”. The same
prepared action was then allowed. The first server attempt rejected an incorrectly unquoted
flow-list tmpfs value; automatic rollback completed before stopping API. The tmpfs value was
quoted and retry was guarded by exact comparison to the restored deployment wrapper. The
existing unused service token was reused; it was never printed or transferred back locally.

## Current live disposition

**The executor is active.** The final activation exited 0 and printed
`LIVE_CODE_EXECUTOR_HTTP_PASS` and `KOSMORA_CODE_EXECUTOR_ACTIVE`. The running API's real
HTTP executor client executed one synthetic Node check, verified UID 65534/read-only files,
and reported passed with verified cleanup. This was a direct internal executor check, not a
paid AI proposal or GitHub publication.

API and executor reached healthy status. Authenticated health, chats, projects, personal
settings, usage and media-capabilities routes returned 200. The migration count stayed 34;
SQLite integrity/foreign keys passed. A consistent backup was verified before the API restart.
Web and owner-login container IDs and start timestamps were identical before and after.
API image remains `cosmora-alpha-app:api-7d779b3`; only its executor service configuration was
added. Web remains `cosmora-alpha-app:chat-tools-0879c45` and login remains unchanged.

The Compose service is `cosmora-alpha-code-executor-1`, private to the internal
`code_executor` network with no published ports. It uses the immutable verified image ID
recorded in `overlay.yaml` and the pinned check image above. The service token is stored only
on the VPS in the release's mode-0700 private directory and is mounted read-only as a secret
in API and executor.

Live browser reload restored the remembered login, six existing chats and their saved
conversation. The Code and Code-agent pages opened; Code-agent loaded the actual allowed
`RLM-Company/Nexus-OS` repository and `main` branch. No project/task/AI message was created
just for browser acceptance. Code-agent still requires selecting/creating a project as part
of its existing workflow. Full live AI proposal → approved check → approved GitHub draft PR
is not established by this activation.

Rollback/config records: `deployctl.before`, `deployctl.next`, `overlay.yaml`, `backup/`
under `/opt/cosmora/releases/code-runtime-20261011`. Restoring `deployctl.before` to
`/opt/cosmora/runtime/deployctl`, recreating only API using that wrapper and stopping
code-executor with `deployctl.next` reverts this configuration without a DB migration.
