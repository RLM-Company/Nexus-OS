# Model Gateway

Provider-neutral streaming gateway for Nexus OS.

Implemented adapters:

- `MockProviderAdapter` for deterministic local development and failure testing;
- `OpenAICompatibleAdapter` for providers exposing a streaming chat-completions endpoint.

The gateway owns routing, timeout handling, normalized errors, and fallback before the first
provider delta. API keys stay in server environment variables.
