# Model Gateway

Provider-neutral streaming gateway for Kosmora OS.

Implemented adapters:

- `MockProviderAdapter` for deterministic local development and failure testing;
- `OpenAICompatibleAdapter` for providers exposing a streaming chat-completions endpoint;
- `AnthropicCompatibleAdapter` for providers exposing a streaming messages endpoint.

The gateway resolves every attempt through the versioned Model Registry before opening the provider
stream. It owns deterministic routing, adapter/model binding, timeout handling, normalized errors,
bounded retry with exponential backoff, an exact-route circuit breaker, fallback before the first
provider delta, and route events used by the atomic Usage Ledger. A timeout applies to one provider
attempt; retry and fallback counts remain bounded by configuration. Provider credentials are
resolved asynchronously through the server-only `SecretResolver` boundary and never enter Model
Registry, Gateway, UI, logs, or parsed configuration.

Active external metadata is time-bounded. Its authorized-discovery source must provide
`verified_at`, `valid_until`, and an evidence reference; registry construction fails once that
window expires so stale prices or vanished models cannot remain silently routable.
