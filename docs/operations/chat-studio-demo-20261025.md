# Chat and Studio presentation update — 25 October 2026

The presentation request replaces chat answer actions with a uniform icon row, adds persistent branded execution profiles and Turbo, and connects explicit image requests to the existing media pipeline. The existing layout and sidebar contents remain intact apart from the explicitly requested collapse control and hiding Skills.

## Runtime behavior

- Mercurius, Mars, Jupiter and Saturnus use the same configured text core. Profile and reasoning preferences are persisted per owner with version checks. Autonomy controls conversational initiative; it grants no additional tool or publication permissions.
- Turbo requests latency optimization, bypasses optional English Relay translation and selects low reasoning on supported models. It does not lower the configured output budget. Turning it off restores the saved effort preference.
- One explicit image request or Generate click dispatches one image generation. There are no automatic retries. Ordinary questions about image generation remain text requests.
- Chat images and Studio use authenticated, owner-scoped media assets and a shared account budget. Provider-reported usage is reconciled; missing usage remains reserved and is not presented as a zero-cost operation. Deleting an image or personal data does not erase billing counters.
- The presentation deployment enables the pinned existing image endpoint through the existing server credential. Credentials are never sent to the browser. Unsupported audio provider routes are not advertised as connected; answer read-aloud uses browser speech synthesis.
- Image reference editing and alternate aspect ratios are blocked until the image route supports them; the UI does not silently discard references.

## Verification before activation

API regression coverage includes persisted profiles, owner isolation, quota checks, Turbo request behavior, real PNG storage, canonical media accounting, background image dispatch and no retry on failure. Browser coverage includes persisted profiles and autonomy, Turbo, full sidebar collapse, aligned icon actions, editable quick replies, token-limit settings and one explicit Studio image request. Type checks and scoped lint are required before release.

Deployment rehearses additive migration 0052 against a verified copy of the live database, compares existing data after activation, and preserves the login, executor and edge services. A live text request and image generation must be checked after activation before claiming the new server release is ready.

PR #380 remains a separate experimental architecture package. Its generated feature catalog is not evidence of 160 implemented production functions and is not part of this release.
