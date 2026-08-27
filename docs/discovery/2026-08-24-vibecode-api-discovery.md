# VibeCode API Discovery runbook

**Date:** 2026-08-24  
**Status:** CONNECTION VERIFIED / CAPABILITY PROBES FAILED / MODEL METADATA INCOMPLETE
**Scope:** read-only discovery for the first real B0.2 model route

## Authorization boundary

Discovery starts only after the owner supplies or connects an authorized VibeCode account/API
access. Credentials stay in the local secret store or environment and are never pasted into chat,
written to this document, committed, logged, or returned by a runtime-status endpoint.

No model call, chargeable request, mutation, account change, or key rotation is part of discovery
unless separately authorized.

## Required inputs

1. Official API base URL and API version.
2. Authentication mechanism and the approved local secret reference.
3. Whether a read-only models/capabilities endpoint exists.
4. Account/organization scope to inspect.
5. Any provider documentation that governs retention, training use, and regional processing.

## Verified evidence — 2026-08-25

- The owner configured the server-side repository variables and `MODEL_API_KEY` secret.
- The authorized GitHub Actions connection test completed successfully with HTTP 200, an SSE
  response, and at least one provider text delta. The workflow does not print the credential,
  endpoint value, or raw response content.
- The official VibeCode site states that request contents and chat history are not stored and that
  token counters are retained for billing:
  [vibecode.moe](https://vibecode.moe/).
- The public Terms state only a general minimum-technical-data and reasonable-security position:
  [Terms of Service](https://vibecode.moe/terms).
- Owner-supplied catalog screenshots now establish exact visible model IDs and displayed prices for
  a subset of Claude, GPT, Gemini, Grok, and DeepSeek routes. The normalized, hashed evidence is in
  [the public catalog evidence record](2026-08-27-vibecode-public-catalog-evidence.md).
- The public homepage's no-request-storage statement conflicts with the public Privacy Policy,
  which permits collection of interaction history for analysis and improvement. Privacy therefore
  remains unknown for confidential routing.
- Exactly two owner-authorized capability requests were executed against `claude-sonnet-5` through
  the configured `anthropic-compatible` route. Structured-output schema enforcement and forced
  tool calling both failed their response contracts despite HTTP 200. The request accounting and
  exact contracts are recorded in
  [the capability probe review](../reviews/2026-08-27-b0-2-vibecode-capability-probe.md).

This evidence proves authentication, configured model routing, streaming availability, and the
displayed catalog price for models visible in the supplied screenshots. It negatively establishes
that the configured `claude-sonnet-5` route did not enforce the tested structured-output or forced
tool-calling contracts. It does not establish exact context/output limits, upstream training use,
regional processing, or contractual retention. Therefore no real entry is added to the committed
registry yet, and VibeCode remains ineligible for confidential routing.

## Read-only discovery sequence

1. Verify the base URL against owner-provided official documentation.
2. Call the provider health/version endpoint if documented.
3. List available models with a read-only endpoint.
4. For each candidate, capture exact model ID, protocol, streaming, structured output, tool calling,
   vision, context window, output limit, rate limits, and lifecycle status.
5. Capture published input/output pricing and currency; unknown values remain `null`.
6. Capture retention, training-use, and confidential-processing evidence. Unknown values remain
   `unknown` and cannot qualify for confidential routing.
7. Save only normalized, secret-free facts in `config/model-registry.v1.json` with
   `source.kind = authorized_discovery`, a verification timestamp, and a documentation reference.
8. Validate the registry schema, run Router tests, secret scan, full CI, and one explicitly
   authorized minimal streaming smoke request.

## Stop conditions

Stop and request owner input if any of the following occurs:

- the endpoint or organization is ambiguous;
- authentication or account connection is missing;
- the operation is chargeable or mutating;
- the provider requires accepting new legal/data terms;
- model pricing or privacy claims conflict across sources;
- discovery would expose credentials or customer/project content.

## Evidence record

The discovery report must record timestamp, endpoints called (without secrets), HTTP outcomes,
normalized registry diff, schema/test results, and unresolved unknowns. Raw provider responses are
stored only if they contain no credentials, personal data, or confidential project content.

## Next action

Obtain a secret-free model metadata export or contractual provider documentation that resolves the
exact context/output limits and privacy conflict. Production Secret Manager selection remains
deferred until a production hosting target is chosen. No further paid capability request is
authorized by this record.
