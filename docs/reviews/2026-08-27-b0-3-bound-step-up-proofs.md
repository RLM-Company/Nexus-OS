# B0.3 review — bound one-time step-up proofs

Date: 2026-08-27

## Decision

Cosmora step-up verification is a provider-neutral proof boundary. A proof is issued only by a
trusted verification adapter and is consumed once by the API. Selecting a production MFA or
identity provider remains a separate deployment decision.

## Security invariants

- The raw proof token is returned once and only its SHA-256 hash is persisted.
- A proof is bound to owner, actor, identity session, registered purpose, exact challenge, and
  expiry.
- A binding mismatch does not burn another actor's proof.
- Successful consumption is atomic and replay fails closed.
- Revoked, expired, or disabled identity sessions cannot consume a proof.
- Audit events never contain raw session or proof tokens.
- Production has no proof-issuance endpoint until a production verification provider is selected.

## Request bindings

| Operation | Purpose | Challenge |
|---|---|---|
| Raise an autonomy profile into a step-up-required state | `autonomy_profile_escalation` | `project:{projectId}:autonomy-profile:{expectedVersion}` |
| Approve a critical tool confirmation | `critical_tool_confirmation` | Existing confirmation `challenge_nonce` |

## Verification

The database suite covers secret hashing, exact binding, owner/session isolation, expiry,
revocation, atomic consumption, and replay rejection. API tests assert propagation of the
authenticated identity and operation challenge into the proof consumer. The repository quality
gate remains the merge condition.
