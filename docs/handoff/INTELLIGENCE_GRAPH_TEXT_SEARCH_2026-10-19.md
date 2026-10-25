# Intelligence Graph — title and saved-text retrieval

19 October 2026. Parent Draft PR372 `6b22c32251278d68fc51149de4b2bd2176a61262`. Runtime stays OFF; no schema or product registration changes, model/provider calls, authority promotion or deployment.

## Behavior

Retrieval now searches both the main searchable text (the workspace node title) and its saved excerpt/detail. A term that appears only in an entered Source/Document body can seed a graph reading, follow candidate links, surface exact citations and appear in the saved-revision report.

Comparison uses Unicode NFC and explicit Russian locale case folding. Original stored strings, line endings, exact quotes, portable bytes and package hashes remain untouched. Token occurrences are sets: repeated words do not increase relevance. Every title match ranks above a body-only match; body relevance breaks title-score ties. Query tokens are compiled once per query. Matching is deterministic and literal, without embeddings, language-model judgment, stemming or remote indexing.

Owner/project, exact-version, time and verification filters apply before lexical candidate scoring/counting. Existing node/edge/depth/fan-out/token budgets remain unchanged.

The retrieval budget now reports `matched_candidates` and `unreturned_candidates`. Multi-hop/local searches use up to three seeds; disconnected matches left outside the returned set now set `truncated=true` rather than suggesting a complete selection. A candidate reached through traversal is counted as returned, so a three-seed search that reaches every match is not falsely marked incomplete.

Explanations/reports include `search_version: title-and-saved-text-v2`. Reproducibility is scoped to a ranking version, saved graph revision and query; software ranking upgrades can change report bytes. The UI displays the new candidate counts alongside existing budgets.

## Verification

277 focused tests across 21 files pass on exact graph source, including source-body-only search, literal CRLF preservation, NFC Cyrillic/Latin equivalence, title priority without frequency stuffing, temporal/verification/scope fences, disconnected/reached candidates and token/node limits. The end-to-end service case searches an entered source body, traverses its unverified SUPPORTS relation, returns the exact quote and reproduces the reading in a report without raising evidence readiness.

Existing real knowledge regressions remain green: unchanged unified fixture has 789 nodes, 789 records and 2387 edges. No synthetic expansion or claim about two-million-node performance is made.

Backend builds, web/E2E TypeScript, scoped lint/format/secrets/diff and production Next webpack build pass. Browser scenarios remain discovered/type-checked only; Chromium execution and hosted CI passes are not claimed.
