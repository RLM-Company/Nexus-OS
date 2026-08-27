# B0.2 review: Model Registry activation gate

**Date:** 2026-08-27  
**Scope:** fail-closed validation before a Model Registry entry becomes routable

## Delivered

- active entries require a verification timestamp and non-empty evidence reference;
- active external entries require `source.kind = authorized_discovery`;
- every active entry must support the streaming contract implemented by Model Gateway;
- a route cannot claim confidential compatibility while training use is not `none` or retention
  remains unknown;
- invalid documents fail during registry construction, before Router selection or provider access.

## Safety boundary

This increment does not add or activate a VibeCode route. A successful streaming response is still
insufficient evidence for exact model identity, limits, price, structured output, tool calling, or
privacy. Those facts remain owner/provider evidence blockers and are not inferred by code.

## Verification

The repository quality gate must pass formatting, secret scan, lint, strict TypeScript, unit/API
tests, production build, and the GitHub Playwright Chromium acceptance job before merge.
