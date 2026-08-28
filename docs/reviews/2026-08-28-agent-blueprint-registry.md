# Agent Blueprint Registry review

Date: 2026-08-28  
Scope: persistence-only project blueprint composition

## Implemented

- Added append-only versions for project-bound agent blueprints.
- Each blueprint stores exact function, behavior-pattern and model-profile references separately
  from grant, memory, task and lifecycle conditions.
- Function and behavior-pattern references must be visible to the same owner/project.
- The selected pattern must allow the selected function and must not be archived, including through
  an older-version bypass after the latest pattern version is archived.
- The grant must be bound to the blueprint project and expire in the future.
- Foreign keys preserve referenced function and pattern versions for reproducibility.

## Verified invariants

- Another owner receives no blueprint data and cannot append a version.
- New versions leave prior rows unchanged, including nested JSON after caller-side mutation.
- Unknown fields such as `status: active` fail closed.
- Cross-project grants, incompatible functions, expired grants and corrupt stored JSON fail closed.
- An existing blueprint remains readable after its pattern is archived, while new composition with
  that archived pattern is rejected.

## Not activated

The model-profile reference is inert and unverified by a route registry. No Agent Instance,
delegation, handoff, status transition, instruction composer, Manager prompt, permission, tool,
model call, API endpoint or runtime execution is introduced.
