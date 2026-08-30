# Agent Studio proposal controls review

**Date:** 2026-08-30  
**Status:** IMPLEMENTED ON REVIEW BRANCH / NOT RUNTIME

## Outcome

This increment turns the existing Agent Studio overview into a bounded proposal control surface.
The owner can select an exact immutable blueprint version and save a root proposal, or select an
existing proposed parent and save a delegated child proposal.

The web client sends a fresh `Idempotency-Key` for each explicit save action and reloads the
project-bound Agent Studio views after success, so the resulting proposal and content-free Decision
Trace entry are visible without leaving the page.

For delegated proposals the UI narrows the visible candidate list by delegation depth and grant
expiry as a usability aid. That filtering is not an authorization boundary. The server-side Policy
Engine remains authoritative and must allow the exact parent/child blueprint pair before the child
is persisted.

## Safety boundary

- root and delegated instances remain database-constrained to `status = proposed`;
- there is no activation, pause, close or executable lifecycle control;
- saving a proposal does not issue the blueprint's declared grant;
- no instruction plan is rendered into model messages;
- no provider, model, tool, network, paid request or external action is invoked;
- no production deployment or production identity/secret provider is selected;
- the page states that the control surface is proposal-only and that agents are not running.

## Verification

The browser acceptance scenario now creates a bounded function, behavior pattern, parent blueprint
and narrower child blueprint through the existing owner API, then saves one root and one delegated
proposal through Agent Studio. It verifies that both Decision Trace operations become visible and
that no activation button exists.

Before merge, the full repository GitHub Actions quality gate remains authoritative for formatting,
secret scan, lint, strict TypeScript, unit/API tests, production build and Playwright Chromium.
