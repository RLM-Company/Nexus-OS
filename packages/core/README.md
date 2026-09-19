# Core

Provider-independent domain services and deterministic Manager Runtime helpers.

Current exported slices:

- `ManagerService` builds provider-neutral project-chat model requests from durable project
  history. It does not execute tools or claim external effects.
- `ChatService` builds ordinary-chat requests separately from project Manager authority.
- `composeDemoManagerPlan` creates the bounded local Manager demo plan; its read-only analysis
  step is synthetic and does not activate worker agents.
- Manager Runtime scenario, suite and task-readiness helpers evaluate the existing contract
  foundation deterministically.

## Boundary

This package is not an autonomous agent loop.

It does not:

- call providers by itself;
- execute Tool Runtime effects;
- bypass Policy Engine, confirmations, step-up or Emergency Stop;
- turn A3-A6 contracts into enabled production autonomy;
- persist secrets or model credentials.

Provider execution, policy enforcement and persistence remain owned by their dedicated layers.
