# Kosmora: verified first-round feature integration

This is an isolated local source integration, not a VPS deployment or live-provider
acceptance. No paid AI calls, GitHub writes, pushed commits, credentials or uncommitted
Code sidecar files were used. The next cloud iteration remains separate.

## Source commits and merge

- Shared base: `7e12e12c5a95b6e29a506052115f66c2ccda78d9`.
- Settings/Relay/research/media: `37d94359df6c5b5322a0bd63715385ed2810a55d`.
  Preserved on local branch `codex/settings-research-media-round1`.
- Code/Windows: exact committed `ee56b91fd023f006cc3a27609c593187440d15ea` from
  `integration-code-windows`; pending sidecar was not copied.
- Work/memory: exact committed `7b1e7a9bef21d899f106023d5f04136a7faf9834` from
  `integration-manager-memory`.

Three-way cherry-pick conflicts were resolved explicitly:

- Ordinary background chat keeps Relay's buffered English response and only assigns
  `response.completed` events to completion after the gateway gains `tool.call`.
- Core exports retain research, Work runtime and project memory.
- Migration journal retains ordered `24 → 26 → 27 → 28`. The main integrator must
  add document migration 25 before deployment; it is intentionally absent here.

Production `ManagerWorkCoordinator` now receives `ownerBudget: accountStore`.
The actual shared owner ceiling is tested before Work provider dispatch; canonical
project usage and the hold are counted once. A restored process uses a new AccountStore
on its reopened SQLite connection and keeps the previous charged ledger.

Relay now fails closed on a tool-call event, rather than interpreting it as a model
completion. Research transport uses an explicit verified IP address family with its
pinned lookup; Node RequestOptions does not expose `autoSelectFamily`, so that unsupported
property was removed. An explicit nonzero family disables the automatic family-selection
path while preserving the vetted destination and TLS hostname.

No funded registry file changed: `tool_calling=false` remains intact. Media retains
production storage `/var/lib/cosmora/media` and paid OFF. The production-protocol smoke
fixture selects its own temporary media directory and explicitly disables paid media.
Windows signed-manifest/installer-hash rollback verification is retained unchanged.

## Checks actually completed on the combined tree

| Check                                                   | Result                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm typecheck`                                        | PASS, 9 packages                                                                |
| `pnpm lint`                                             | PASS, 9 packages; actual completed process                                      |
| `pnpm build`                                            | PASS, 9 packages including Next production `/code-agent`, settings and research |
| API + gateway + db + core + tool-runtime regression run | 418 PASS, 1 failed restart fixture, 3 OCI skips                                 |
| Work + Relay after fixture correction                   | 38/38 PASS; closed the sole broad-run failure                                   |
| Windows policy/state/signature/rollback tests           | 24/24 PASS                                                                      |
| Production compatible-protocol loopback smoke           | PASS: owner auth, project chat, Work three stages, Critic and download          |
| Code Chromium intercepted-API scenarios                 | 3/3 PASS                                                                        |
| Work/memory/checkpoints/reload/stop Chromium scenarios  | 7/7 PASS                                                                        |
| Scoped Prettier, secret scan, whitespace                | PASS                                                                            |

The restart failure was in the expanded fixture: it spread an AccountStore attached to
the old closed SQLite connection into the restarted coordinator. It now mirrors production
boot by constructing AccountStore on the new connection; the test checks retained 600 tokens
across plan/draft/review and confirms the completed plan was not repeated. Unrelated passed
suites were not rerun after this fixture-only correction.

The earlier hanging sandbox lint/typecheck is not counted as successful. The actual combined
gates above completed using the approved local execution environment. Owned stale diagnostic
sessions were stopped; no production process was touched.

## Activation blockers and remaining boundaries

- **Paid Code proposals must stay inactive until the next Code package adds the real
  owner-budget guard and approved OCI lifecycle integration.** This exact first-round Code
  commit has project accounting but lacks the global ownerBudget integration; no parallel
  replacement of the cloud implementation was introduced.
- Actual OCI tests were skipped without an operator-provisioned immutable image/runtime.
  Fixture executor tests and Code UI do not prove live OCI isolation, cleanup or real GitHub
  publication. No host-shell fallback was added.
- Live paid media remains unverified and disabled without its own credentials/opt-in.
  Browser voice is user-triggered and browser-dependent.
- Privacy export/delete, retained accounting, generative research synthesis, enhanced media
  lifecycle, arbitrary Work DAG, Code sidecar and Windows reconnect belong to the next cloud
  round. Current settings' broader delete/export limitations remain explicitly documented;
  this integration does not claim those follow-up functions are complete.
- Document migration/schema/UI from the main integrator, VPS rollout, native Windows
  install/upgrade/uninstall acceptance and a live paid model/GitHub workflow are not tested here.

Apply the final integration delta after `37d9435`; it includes both exact feature packages
and the merge corrections. Preserve the separate document migration 25 and the future cloud
changes when resolving root's final journal/app/server integration.
