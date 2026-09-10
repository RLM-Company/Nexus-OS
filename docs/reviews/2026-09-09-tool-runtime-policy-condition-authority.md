# Tool Runtime conditional policy authority

Date: 2026-09-09
Status: `SECURITY HARDENING / FAIL-CLOSED`

## Problem

`ToolInvocation` previously accepted `activeConditionIds` directly from the invocation. Those identifiers can trigger named conditional expansions in the Policy Engine, including A5 expansions such as a subsequent production release after the first approved release.

The invocation is not an authority source. A Manager, agent, tool caller, replay payload, or compromised adapter must not be able to self-assert that an approval-derived policy condition is active.

## Boundary

Conditional policy evidence is now supplied only through `GuardedToolRuntimeOptions.resolveActiveConditionIds`.

The resolver receives a bounded context:

- project ID;
- actor ID;
- object IDs;
- resolved capability IDs;
- evaluation timestamp.

The default resolver returns no active conditions. Therefore a runtime with no authoritative condition source remains fail-closed and uses only the base policy profile, active permissions, and point overrides.

Caller-supplied `activeConditionIds` is no longer part of `ToolInvocation` and has no effect even if an untyped object contains that property.

If the trusted resolver throws or rejects, Tool Runtime returns `PAUSED` and does not execute the tool.

## Non-goals

This change does not decide how a future production condition store proves that a condition is true. It creates the injection boundary for that later authoritative implementation.

It does not activate A6, choose a production provider, or perform any real production/finance/external effect. Tests use inert fake tools only.

## Regression coverage

Focused tests verify that:

1. an invocation cannot self-assert an A5 production conditional expansion;
2. a trusted runtime resolver can supply the canonical condition;
3. resolver failure pauses the action and never calls the tool.

Full repository `pnpm check` remains mandatory before merge.
