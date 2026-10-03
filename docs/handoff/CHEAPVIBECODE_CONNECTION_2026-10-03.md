# CheapVibeCode configuration — 2026-10-03

CheapVibeCode is a separate provider from `vibecode.moe`; existing VibeCode registry evidence and
credentials are not reused for it. The owner authorized account registration and accepted the
service terms. Registration completed, and the service supplied an API key automatically.
Credentials are held outside the repository in a private directory accessible only to the current
Windows user and SYSTEM. They must not be included in source archives, images or desktop builds.

## No-cost evidence

- Official portal instructions: `https://www.cheapvibecode.ru/portal/docs`.
- Base URL: `https://ru.cheapvibecode.ru/v1`.
- Authenticated GET `/models` succeeded and listed 42 models.
- Authenticated GET `/balance` succeeded and returned `token_balance: 0`.
- The catalog reports `gpt-5.5`, streaming support, context 258,000, maximum output 128,000 and
  billing multiplier 4. These are provider declarations, not independently exercised capabilities.
- The opt-in candidate registry limits that route to 32,000 context and 1,200 output tokens,
  permits the bounded Manager stages and disables tool calling, structured-output and vision claims.
- Privacy remains unknown; confidential routing is disabled. Pricing remains null because the
  provider bills weighted token units rather than the registry's monetary input/output prices.
  This candidate must not be treated as proof of a usable monetary ceiling.
- Registry evidence expires on 10 October. The default mock registry remains unchanged.
- No model generation, paid test or emergency-stop clearance has occurred.
- Offline validation loaded the candidate through the API schema and built the external runtime
  using a fixture key, then resolved plan, draft and review routes. Network calls: zero;
  fallback disabled, one attempt per route and emergency stop enabled.
- At the owner's subsequent request, the protected VPS `model.env` was updated from the staged
  CheapVibeCode profile. The prior file was preserved privately for rollback. Only the API container
  was recreated; model execution remains globally stopped and no generation was requested.

## Opt-in configuration

Use this only in a private environment file; fill the key locally and keep execution stopped
until funding and the bounded live trial are ready. The VPS uses this profile:

```dotenv
MODEL_PROVIDER=openai-compatible
MODEL_PROVIDER_ID=cheapvibecode
MODEL_REGISTRY_PATH=config/model-registry.cheapvibecode.manager-work-preview.v1.json
MODEL_BASE_URL=https://ru.cheapvibecode.ru/v1
MODEL_API_KEY=replace-privately-never-commit
MODEL_NAME=gpt-5.5
MODEL_FALLBACK_TO_MOCK=false
MODEL_MAX_ATTEMPTS_PER_ROUTE=1
MANAGER_MAX_OUTPUT_TOKENS=1200
RUNTIME_EMERGENCY_STOP=true
```

GitHub Actions should use the same provider/base URL/model/fallback/output settings, with
`MODEL_API_KEY` held as a secret. The connector cannot manage Actions Secrets/Variables, and the
browser currently requires the owner to sign in. A matching set of ten variables and one secret
was prepared privately; GitHub settings have not yet been changed. No connection-test workflow
was dispatched. The connection workflow now defaults to authenticated catalog/balance GETs,
with zero generation requests. Its optional live trial requires an explicit workflow input,
`RUNTIME_EMERGENCY_STOP=false`, fallback disabled, one attempt and a positive CheapVibeCode
balance; it sends one request capped at eight output tokens with no retry. The Actions stop
variable is a separate configuration from the VPS's persisted stop and does not clear it.
Provider error bodies and generated text are never printed by the check.

Do not run the provider's desktop/CLI installer scripts to configure Cosmora. The existing
OpenAI-compatible adapter already uses the documented chat endpoint; changing Codex settings or
installing another coding client is unnecessary.

## Funding gate

The owner authorized at most 100 RUB total for the initial top-up and trial, without a subscription
or automatic top-ups. The minimum 100 RUB SBP top-up totals 103.50 RUB including commission and
was not submitted. Lolz Market shows a 100 RUB total; two normal UI attempts, including one after
reload, failed with `csrf check failed` before opening a payment page. No CSRF protection was
bypassed, no payment succeeded and the balance remains zero. The live test remains blocked by
funding; API-key existence alone is not a successful model response.

The [service offer](https://www.cheapvibecode.ru/offer) prohibits resale of access and operation as
a public proxy. A later public or paid Cosmora rollout requires reviewing the intended use against
the provider's terms; this checkpoint covers private alpha preparation only.
