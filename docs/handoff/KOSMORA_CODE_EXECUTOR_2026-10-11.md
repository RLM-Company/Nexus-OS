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
