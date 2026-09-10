# Manager Runtime context task-input boundary

Date: 2026-09-09
Status: `CONTRACT HARDENING / FAIL-CLOSED`

## Problem

Runtime context materialization already checked project binding, data classes, memory scope, source IDs and materialized artifact identity. Two composition checks were still separate:

1. a context could declare an artifact that was not listed in the task's `input_artifact_ids`;
2. context materialization did not compose the canonical role-level artifact exchange rule, so an artifact kind not accepted by the assigned role could reach the materialized context unless another caller remembered to validate it separately.

## Boundary

`validateRuntimeContextMaterialization` now requires every declared context artifact to be an explicit task input and composes `validateRuntimeArtifactExchange` for every materialized artifact.

This keeps context construction aligned with both the task contract and `MANAGER_RUNTIME_ROLE_CONTRACTS`.

The change is validation-only. It adds no runtime execution, model call, tool call, authority expansion or external effect.

## Regression coverage

Tests cover:

- an artifact injected into context without being declared by the task;
- a `critic_verdict` artifact delivered to an analyst, whose role contract does not accept it;
- existing cross-project, D4, provenance, memory and exact materialization boundaries.

Full `pnpm check` remains the merge gate.
