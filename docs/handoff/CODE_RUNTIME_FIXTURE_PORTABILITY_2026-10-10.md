# Code runtime fixture portability — 2026-10-10

Fixed Windows portability in three test files only. Production `code-agent-workspace.ts` is unchanged.

- Synthetic OCI transport fixtures launch real Node child processes through a test-only spawn adapter. Shell execution remains disabled; Docker/Podman arguments and the sanitized environment are passed intact. Cancellation/deadline tests require an observed `start` stage, cleanup is verified, and failed cleanup still quarantines the runner. The unavailable fixture must record actual create/removal calls.
- Under parallel turbo load, the deadline and quarantine fixtures wait for a recorded real `create → cp → start` sequence while a test-only virtual timer holds the production deadline callback. The callback is then advanced by its configured 100 ms; actual process termination/removal and all stage assertions remain required. Cancellation also waits for the real start. These fixtures test deadline enforcement, not host startup latency. Startup polling is bounded to 15 seconds and the process-test harness to 30 seconds.
- Git round trips explicitly disable `core.autocrlf` in each temporary test repository, then run real `git apply --check` and `git apply` and compare exact file bytes, including intentional CRLF.
- External Git round-trip cases have an explicit 30-second test harness budget so the default 5-second Vitest limit does not race real Git startup during parallel package checks. Assertions and actual Git application are unchanged.
- PAX tests verify UTF-8 archive names, real tar extraction, exact Unicode filesystem paths/content, empty ordinary files and absence of symlinks. They no longer assume Windows tar's display uses UTF-8.

Final checks after load synchronization on Windows: package lint **passed**, package TypeScript **passed**, changed-file formatting **passed**, and one full package run **61 passed / 3 skipped** (6 files; session 45541, exit 0, 3.16 seconds). The 3 skips are the existing real OCI operator gate without `CODE_AGENT_TEST_IMAGE`; no new platform skips were added. The overall parallel workspace rerun remains owned by the primary integration agent.

`TMP`/`TEMP` were set to a writable checkout directory to avoid the Windows sandbox's Vitest cache rename error. Synthetic process/HTTP/Git/archive tests do not establish OCI isolation. The real daemon/image integration remains for the separate Linux verification stage. No runtime security policy, deployment or commit was changed.
