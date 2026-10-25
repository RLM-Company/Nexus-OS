# Exact quoted evidence for graph relationships

Stacked on graph privacy PR #368. Runtime integration stays OFF and no managed migration is allocated. Evidence remains user-authored/discovered; no model calls or automatic verification are introduced.

## Authoring and history

`cite_edge` selects an active Source/Document node version, a literal location (up to 256 characters) and an exact nonblank fragment from that version's saved text (up to 1,000 characters). The server independently rejects invented fragments, wrong-kind/foreign/stale sources and unexpected authority fields. A citation creates a new discovered edge version with an explicit source/version/location and optional `evidence_excerpt`; its predecessor stays in history. `clear_edge_evidence` similarly retracts the live quote without destroying historical revisions.

Source edits never silently reattach an old quote to new text. A still-cited old source version is shown as superseded. Source deletion retracts live citations to any version of that source, including citations on non-incident edges; old quoted versions remain historical. Editing relation endpoints also resets their evidence. All changes use existing revision CAS, writer fences and total-version quotas.

The Russian monochrome editor shows exact source text, quote preview and explicit review before submitting. Failed requests keep the draft. Since HTML textareas normalize newlines, selection maps normalized CR/LF back to the original saved fragment, preserving original CRLF/CR without changing words, punctuation or spaces. HTML and `$&` are plain text. History comparison now shows quote and location changes.

## Portable content

`kosmora.intelligence-graph.v1` edges support optional `{evidence:{source,location,excerpt}}`. Old packages retain their existing canonical shape and hashes. Extra fields remain forbidden. Browser and server independently require an exact matching Source/Document text fragment. Imports allocate fresh IDs and discovered statuses, remapping citation sources rather than copying ownership or verification.

When a current relation cites an older source version, export includes that exact source text as an additional independent portable Source/Document node. This preserves the quote while carrying no original identity/supersession/verification state. Importing the content is not an independent check of the claim. Existing package byte/node/edge limits still apply.

## Validation

233 focused tests passed on exact graph source (20 files), including quote/schema validation, HTTP rejection, source edits/deletion, old-source export/remap, original Unicode/HTML/CRLF bytes and restore comparison. API/core/contracts types and builds plus web/E2E types, scoped lint/format, production Next webpack build, diff/secret checks passed. Six Playwright scenarios are discovered, including textarea normalization and literal HTML; execution is unconfirmed because Chromium is absent. No hosted CI success, main merge or deployment is claimed.
