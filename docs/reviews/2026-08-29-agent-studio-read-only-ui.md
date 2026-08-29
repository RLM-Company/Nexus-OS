# Agent Studio read-only owner UI review

**Date:** 2026-08-29  
**Scope:** project Agent Studio overview in the web control center  
**Runtime status:** not activated

## Implemented

- Dedicated responsive `/agent-studio?project=<id>` route.
- Project ID selector and parallel loading of the five existing owner-bound read APIs.
- Summary counts, proposed team tree, blueprint references, function/pattern summaries and newest
  content-free Decision Trace events.
- Explicit persistent safety label: read-only and agents are not running.
- Empty, loading, refresh and API-error states.

## Verified invariants

- The page compiles under strict TypeScript, passes web lint and completes a production webpack
  build.
- Rendered views do not include pattern instructions, result/task contracts, secrets or raw grants.
- There is no activation button or activation API call in the route.
- An e2e test creates a test project, opens the page, checks the safety label and empty proposal
  state, and asserts that no activation button exists.
- The repository CI remains the authoritative browser check because the partial local snapshot has
  neither its normal dependency topology nor a Playwright Chromium binary.

## Deliberately absent

- create/version/archive forms;
- root or delegated proposal forms;
- activation and executable lifecycle controls;
- executable prompt composition and permission issuance;
- provider/model/tool calls, paid requests and external actions;
- production authentication/hosting decisions.

This screen makes the already-persisted control-plane structure understandable without expanding
what the system can do.
