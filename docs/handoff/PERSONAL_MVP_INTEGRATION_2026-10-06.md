# Personal Cosmora integration — 6 October 2026

Base: `9862fb6`, branch `codex/studio-files-clean-composer-20261004` (#311).
Integration branch: `codex/personal-mvp-integration-20261006`.

## Sources and behavior

- GitHub/Code #314: `cec2d1e` and `f6ceecb`. Includes multi-file review, repository/access
  binding, branch pagination, recovery and read-only reconciliation after an uncertain
  publication. Review confirmation is never restored as approval.
- Ordinary chat #316: `7d40ea6` and `f3e87fa`. Includes bounded local drafts and files,
  local phone-photo preparation, stream recovery without resubmission and accessibility.
- Studio/CSV v3: exact patch SHA-256
  `374366988fc76b9d1540c147d232646aec4f6713c4b2c97e10a7af3f220e0f9a`.
  Includes CSV filtering/statistics, explicit sample coverage, Unicode document search,
  progress/cancel and a 200,000-row regression.
- Windows v3: exact patch SHA-256
  `3b7c1b4fb3a693315fad11b328b1c88ebcce9ab6de80faddcb247a04562cb279`.
  Windows 0.9.0 uses normal web login, saved HTTPS origin, reconnect, isolated downloads
  including same-origin blob URLs, single instance and no-network packaged smoke mode.

Both text exports were reconstructed from the originating project chats and matched
their original SHA-256 before application. Their source artifacts remain in the team's
local `team-results` directory; secrets were not transferred.

## Integration repairs

- Compose transfers wait for enabled draft hydration before focusing the chat input.
  The existing Code-to-chat regression exposed the premature focus.
- Initial chat selection completes before the composer unlocks. A full-suite run exposed
  a later route read resetting text entered before hydration; the corrected chat/Studio/
  workspace subset passed 31/31.
- Studio's optional highlight offset accepts `undefined` under strict TypeScript.
- CSV avoids row-array spread and rejects over 2M padded cells before allocation.
  New parser tests cover four delimiters, 200k rows, excessive padding, empty records,
  filter-aware statistics, malformed quotes and oversized selections.
- CSV browser assertions target the relevant statistic and allow locale number grouping.
- The two `DEPENDENCIES.md` notes were combined without overwriting the chat note.
- The default synthetic API test server installs the chat-reliability fixture. A separate
  integration launcher strips inherited model/GitHub credentials, explicitly selects mock
  and refuses occupied test servers. No `.env` is copied into this checkout.
- Windows upgrade tests pin verified 0.8.0 from PR #292 (`266c1868`) as baseline.
  Version 0.9.0 is newer; the workflow never starts baseline networking. The lifecycle
  script requires a disposable GitHub-hosted VM and checks its work-directory boundary,
  executable metadata, shortcuts, registry cleanup and preserved-data hashes.
- Native Windows ICO is rendered from the supplied SVG. Code signing and releases are
  separate; no installer is silently installed on the owner's machine.

## Verified before final browser/CI pass

Repository formatting, secret scan, lint and strict TypeScript passed. All repository
unit/API tests, deployment/access tests, connection fixtures and secret-scanner fixtures
passed, and all nine packages built. Studio/workspace transfer subset passed 19/19 after
the integration repairs. Windows policy/syntax and developer-machine guard passed 15/15;
PowerShell parsed successfully.

The first combined browser pass passed 167/168 and exposed the Code focus issue, since
fixed. The first Studio subset exposed two ambiguous/locale-sensitive assertions, since
fixed. These earlier failures are not final-success evidence. The complete final browser
suite and GitHub-hosted Windows installer lifecycle are pending at this commit.

Local NSIS packaging hit a timeout downloading an external builder component. No local
installer, Windows GUI success or installation is claimed. The GitHub Windows workflow
must verify the actual current/baseline installers and lifecycle before desktop acceptance.

## Release boundary

This is private personal use. Paid AI acceptance remains deferred until funding. Persisted
photos do not prove vision; selected document/CSV parts do not constitute analysis of the
entire source. The English Relay idea remains off and unimplemented (#318).

No live model calls, payment, main merge, production deploy or secret rotation was part
of this integration. Existing data, owner access and server emergency stop remain intact.
Old Windows diagnostics, update and signed-release features remain in their original PR
stack and must be adapted separately to the form-login runtime rather than reviving Basic
authentication. Each module's detailed handoff retains its historical validation boundary.
