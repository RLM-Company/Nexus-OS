# B0.2 review: secret resolver boundary

**Date:** 2026-08-27  
**Status:** implementation candidate

## Scope

This increment narrows credential propagation without selecting a deployment vendor:

- `ServerConfig` validates credential presence but retains only `modelApiKeyConfigured`;
- an asynchronous provider-neutral `SecretResolver` resolves approved secret names;
- `EnvironmentSecretResolver` is the current server-only implementation for local environment and
  GitHub Secrets injection;
- the API composition root resolves `MODEL_API_KEY` immediately before Model Runtime construction;
- the resolved value is passed directly into the selected provider adapter and is never returned by
  `buildModelRuntime`;
- missing secrets fail startup before any provider request;
- mock/offline runtime never resolves a provider credential.

## Safety properties

- No credential value survives in parsed configuration or its JSON serialization.
- The web application, shared contracts, runtime-status response, logs, database, and Model Registry
  remain secret-free.
- The resolver accepts only the typed allow-list `MODEL_API_KEY`; arbitrary environment access is
  not exposed through the interface.
- The asynchronous contract supports a future managed backend without changing Model Gateway,
  Manager Core, or UI contracts.
- Errors report missing configuration without echoing the secret name's value.

## Verification

Tests cover environment resolution, missing/empty values, config serialization, external runtime
binding, and fail-closed startup when the resolver returns no credential. The full monorepo gate and
browser acceptance gate remain mandatory before merge.

## Deferred deployment decision

This increment is not a claim that process environment is the final production Secret Manager.
Selecting AWS/GCP managed secrets, Vault, or a hosting-native equivalent depends on the production
deployment target and requires an explicit infrastructure decision.
