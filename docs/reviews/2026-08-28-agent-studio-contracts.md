# Agent Studio contract review

Date: 2026-08-28  
Scope: shared composition records and fail-closed delegation validation

## Implemented

- Function definitions and behaviour patterns are separate, versioned records.
- A behaviour pattern may contain working-style instructions and compatibility metadata, but its
  schema rejects tools, capabilities, data scopes and budgets.
- A project-bound blueprint composes function, pattern, model-profile reference, grant, memory,
  task/result conditions and lifecycle metadata.
- Agent instances are temporary lifecycle records; handoffs preserve bounded summaries, evidence
  references, open questions and known errors.
- Empty grant arrays mean no authority, never wildcard authority.

## Delegation invariant

Policy Engine accepts a child only when it keeps the same owner and project, uses subsets of every
capability/tool/data/object set, does not increase any budget, expires no later than the parent, and
reduces delegation depth. Any ambiguity returns `allowed: false` with reasons.

## Not implemented

No registry, persistence, instruction composer, Manager system prompt, automatic team creation,
agent HTTP surface or tool execution is activated by this contract-only increment.
