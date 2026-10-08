# Funded personal chat — 2026-10-08

The private hosted chat now uses CheapVibeCode gpt-5.5 with execution enabled, one route attempt
and mock fallback disabled. Funding was confirmed by authenticated discovery: 31,250,000 provider
balance units before the live tests. Model output counters and weighted balance units are
different measures; no monetary cost is inferred.

Three bounded requests were sent through the actual hosted interface:

1. A one-word reply: `работает`; 256 input and six output tokens.
2. A fictional attached Markdown brief: three launch priorities, a seven-day plan, a one-minute
   demo and explicit assumptions; 646 input and 435 output tokens.
3. An artificial PNG with three circles, uploaded through the paperclip: correct answer `3`;
   321 input and five output tokens. No personal photographs were used.

The first three usage rows committed successfully: 1,223 input plus 446 output = 1,669 model tokens.
Saved chat history survived reload. Copying the plan worked and its Markdown was saved locally.
Live download capture timed out in the in-app browser; it is not claimed as a confirmed live
download. The normal Chromium export scenarios passed locally, including complete long-answer
and code downloads. No additional paid request was used to verify history or exports.

## Operational changes

The environment-triggered process stop was recovered offline after a verified SQLite backup and
confirmation that no work was active or queued. Only the environment switch changed in
`model.env`; provider and GitHub credentials were retained. Recovery created immutable audit
event `7fb3a275-ad29-4def-9e23-5b055a4fe1773` and kept existing HTTP step-up recovery intact.

Authenticated catalog discovery confirmed the configured model, streaming, declared image
support, 258,000 context and 128,000 maximum output. The reviewed route remains capped at
32,000 context and 1,200 output, with tools and structured-output claims disabled, unknown
pricing and confidential routing disabled. Vision is enabled after the bounded real image test.
Registry evidence now expires on 15 October at 14:14 UTC; it must be refreshed before expiry.

The internal server bearer was rotated using the existing seven-day issuer, with unchanged
owner permissions. It expires on 15 October at 14:25 UTC. This is separate from browser login;
no timer or automatic renewal is installed. Browser login still lasts eight hours.

The prepared thirty-day remembered login in `bc16fe0` is **not deployed**. Automatic approval
review rejected its deployment pending explicit owner confirmation of the duration and login
service restart. Do not apply its prepared override without that confirmation. Native app
inspection also timed out at the computer-use approval boundary; no native login was automated.

## Final interface fixes and checks

Ordinary-chat headers now follow the selected or renamed chat title. In-progress ordinary
replies identify Kosmora rather than the project Manager. Project-specific status labels remain
unchanged. Four title assertions extend the existing rename/archive/reopen test.

Production web build, formatting and secret scan passed. Thirteen chat reliability scenarios
passed, followed by the corrected rename/archive/export scenario. Thirty-eight deployment tests
passed locally and nine offline-recovery tests passed inside the VPS runtime image. The full
monorepo gate passed for `93ce43e`. Windows syntax/build/install/upgrade/uninstall checks passed;
only uploading the installer artifact failed. Final frontend/registry commit CI must be checked
separately.

### Deployment proxy regression

Final live inspection exposed blank/unstyled pages despite healthy containers and individually
successful asset requests. The API log showed a public root request arriving as
`GET /__owner/verify` at the API, even though Caddy's active configuration sent that path to the
separate login service. The current Caddy 2.11.4 symptoms match the official
[wrong-upstream connection advisory](https://github.com/caddyserver/caddy/security/advisories/GHSA-6365-7ppr-5r92),
which affects versions below 2.11.5. Temporarily restoring frontend 61bd267 did not remove the
proxy failure. Deployment now pins the current stable
[Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), which also fixes later
HTTP/2 and idle-stream regressions. Authentication routes, HTTPS settings, volumes and owner
permissions stay unchanged. The patched proxy and final frontend loaded the chat successfully
in a fresh browser session. The access verifier now fetches referenced scripts/styles concurrently,
validates MIME and same-origin boundaries, and rechecks unauthenticated root/API access during
asset loading. Three new regression scenarios cover missing/wrong/redirected assets, off-origin
credential isolation and authentication failure only during concurrent loading; 41 deployment
tests passed locally. A repeated live concurrent probe remains part of the final server check.

### Final live checks and recovery

The patched proxy passed 160 concurrent authenticated asset/navigation/API and unauthenticated
boundary checks, plus 30 separate unauthenticated checks. The strengthened access verifier passed
against the actual hosted site and replaced the runtime verifier hook. Fresh browser inspection
confirmed correct chat titles and a configured GitHub repository with its branches and file tree.
A verified private SQLite snapshot was copied off the VPS into an owner/SYSTEM-only directory;
its checksum matched the manifest.

One final multi-turn request failed with `PROVIDER_ERROR` and no text. No unobserved token usage
is inferred for that failed request. Automatic approval review initially blocked a diagnostic
replay; the owner then explicitly authorized further tests. One replay of the exact synthetic
conversation, capped at 128 output tokens, returned HTTP 200, valid SSE, a stop marker and the
correct eight-character answer (285 input plus six output tokens). Restoring and sending the
request through the actual UI then succeeded with 308 input plus six output tokens and retained
the original conversation context. The failure did not reproduce; its exact cause remains
unconfirmed rather than being attributed to a specific provider defect.

Four successful application requests total 1,531 input plus 452 output = 1,983 model tokens.
Including the single successful diagnostic replay gives 2,274 confirmed model tokens across five
successful generations. There was one additional failed application request whose usage was not
reported. Keep these counts separate from weighted provider balance units.

Gateway errors now expose only allowlisted HTTP-status/protocol diagnostic codes in operator
logs. Arbitrary provider messages, request contents and exception causes remain unlogged.
Sixty-five gateway tests, the gateway build and API typecheck passed. No automatic paid retries
or mock substitutions were enabled.

The existing local Windows 0.10.0 installer opens the hosted UI; it needs no rebuild for these
server and frontend changes. Media-generation sections remain prompt editors, not tested image,
video or audio generation services. Manager routing passed the no-generation preflight; a full
paid Manager work loop was not executed.
