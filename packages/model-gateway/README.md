# Model Gateway

Provider-neutral streaming gateway for Cosmora OS.

Implemented adapters:

- `MockProviderAdapter` for deterministic local development and failure testing;
- `OpenAICompatibleAdapter` for providers exposing a streaming chat-completions endpoint;
- `AnthropicCompatibleAdapter` for providers exposing a streaming messages endpoint.

The gateway resolves every attempt through the versioned Model Registry before opening the provider
stream. It owns deterministic routing, adapter/model binding, timeout handling, normalized errors,
fallback before the first provider delta, and route events used by the atomic Usage Ledger. API keys
stay in server environment variables.
