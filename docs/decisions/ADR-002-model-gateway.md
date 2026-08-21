# ADR-002: Provider-neutral Model Gateway

- Status: Accepted
- Date: 2026-08-20

## Context

Nexus needs one stable manager contract while model vendors, endpoints, model names, prices, and
availability can change. Provider credentials must remain server-side, and a failed stream must not
corrupt durable chat history.

## Decision

All model access goes through `packages/model-gateway`.

- `ManagerService` assembles the provider-independent request and durable conversation context.
- Adapters translate that request into provider protocols.
- OpenAI-compatible models use the streaming `/chat/completions` protocol.
- Anthropic-compatible models use the streaming `/messages` protocol. System messages are moved to
  the top-level `system` field, while user and assistant messages retain their order.
- The gateway owns timeout, cancellation, normalized errors, and fallback selection.
- Fallback is allowed only before the first text delta. After output begins, failure terminates the
  run so content from different models is never combined.
- Provider and resolved model are persisted with each completed run.
- Reported input and output token counts are persisted. Monetary cost remains unset until explicit
  pricing for the selected model is configured.
- Credentials are read only from server environment variables and are excluded from logs, API
  responses, browser code, and version control.

## Consequences

Connecting either supported protocol requires configuration rather than changes to Manager Core.
Provider-specific features such as tool-use content blocks require explicit adapter support before
they can be enabled. The mock adapter remains available for deterministic tests and offline
development.
