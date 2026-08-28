# Agent Instruction Plan review

Date: 2026-08-28  
Scope: pure, non-executable instruction preview composition

## Implemented

- Added a structured plan contract with fixed precedence: Constitution, policy, function,
  behavior, task.
- Added a pure Policy Engine composer that derives authority labels rather than accepting them from
  behavior or task content.
- Function and behavior sources must match the blueprint's exact versions and remain visible to the
  same owner/project.
- Archived or function-incompatible behavior patterns are rejected.
- Blueprint grant, memory and lifecycle constraints remain structured in the function layer.
- All supplied objects are cloned before the plan is returned.

## Adversarial checks

- Behavior text that claims administrator authority remains in the behavior layer.
- An authority-shaped field smuggled into a behavior pattern violates its schema.
- Cross-owner, cross-project, wrong-version, archived, incompatible and malformed sources fail
  closed.
- Caller mutation after composition does not modify the plan.

## Trust boundary

The plan is always `executable: false`. Versioned Constitution and policy sources are structurally
required but their authenticity is not established by this pure function; a later trusted
composition root must resolve them. The composer does not interpret natural language, remove
semantic conflicts, convert the plan to model messages or grant runtime authority.

No final Manager prompt, provider routing, model/tool call, lifecycle transition, activation,
permission issuance, API endpoint or runtime execution is introduced.
