# B0.3 review: verified request identity boundary

**Date:** 2026-08-27  
**Status:** implementation candidate

## Delivered

- a provider-neutral request identity resolver interface;
- bearer-session resolution backed by the durable Identity Core;
- an explicit development/test static adapter for the existing local workflow;
- a public health endpoint and authenticated application endpoints;
- immediate rejection of missing, malformed, expired, revoked, or disabled sessions;
- verified owner propagation through projects, messages, runs, emergency stops, profiles, and
  confirmations;
- verified actor attribution for emergency stops and confirmation decisions;
- owner-filtered operational project-stop and active-run counts;
- production app construction fails closed when no resolver is supplied.

## Boundary

This increment does not expose a session-issuance endpoint or choose OAuth/OIDC, passkeys, email,
2FA, cookies, or a deployment platform. Production server wiring accepts only durable bearer
sessions; a future identity-provider adapter must perform enrollment and issuance through
IdentityStore.

Step-up verification remains a separate boundary. The next increment must bind step-up proofs to
the verified actor, session, purpose, nonce, and expiry so they cannot be replayed across requests.
