# VibeCode API Discovery runbook

**Date:** 2026-08-24  
**Status:** READY / WAITING FOR OWNER-AUTHORIZED ACCESS  
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
