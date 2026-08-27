# B0.2 review: VibeCode capability probe

**Date:** 2026-08-27  
**Status:** STRUCTURED OUTPUT FAIL / TOOL CALLING FAIL  
**Model:** `claude-sonnet-5`  
**Protocol:** `anthropic-compatible`

## Authorization and request accounting

The owner authorized exactly two minimal paid provider requests: one structured-output probe and
one tool-calling probe. Both were executed once through GitHub Actions. No retry, model fallback,
customer content, project content, secret value, or raw provider response was persisted.

| Capability        | Run ID        | HTTP | Contract result | Provider requests |
| ----------------- | ------------- | ---: | --------------- | ----------------: |
| Structured output | `33081888383` |  200 | FAIL            |                 1 |
| Tool calling      | `33082228707` |  200 | FAIL            |                 1 |

Total paid provider requests: **2**.

## Probe contracts

The structured-output request supplied a strict JSON schema requiring exactly `{ "ok": true }`
while the prompt explicitly requested plain text. The HTTP 200 response contained plain text and
did not satisfy the schema, so server-side structured-output enforcement is not established.

The tool-calling request supplied one strict tool, forced that tool by name, and used an adversarial
prompt asking the model not to call it. The HTTP 200 response did not contain a matching `tool_use`
block with schema-valid input, so forced tool calling is not established.

These results describe the configured VibeCode route and compatibility layer at the time of the
probe. They do not prove that the upstream model lacks these capabilities when called through a
different provider or protocol.

## Execution note

The first workflow intended to run both requests but stopped after the structured-output failure
because a helper re-enabled shell `errexit`. Logs establish that only the first request ran. A
recovery workflow was narrowed to the single unspent authorization and made only the tool-calling
request. The one-off network workflow was then removed to prevent accidental paid reruns.

## Routing decision

No VibeCode registry entry is activated. `structured_output` and `tool_calling` must remain false for
this route unless new, separately authorized evidence supersedes this review. Exact context/output
limits, contractual retention, upstream training use, regional processing, and a production Secret
Manager target also remain unresolved.
