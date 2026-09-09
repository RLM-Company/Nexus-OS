# Manager Runtime critic artifact validation v1

## Purpose

Bind a `CriticVerdict` to the concrete runtime artifacts it claims to review without giving the Critic any execution, permission, policy, or arbitration authority.

## Invariants

`validateCriticVerdictAgainstArtifacts` fails closed when:

- the base critic severity/pause contract is invalid;
- the supplied runtime artifact set contains duplicate artifact identities;
- a reviewed artifact ID is missing from the supplied set;
- a reviewed artifact belongs to another project;
- a reviewed artifact kind is not accepted by the canonical `critic` role contract;
- a reviewed artifact was created after the verdict, comparing timestamps by instant rather than raw ISO text.

The validator does not infer artifact payload content, validate external evidence IDs, choose a winning conclusion, or mutate runtime state.

## Security boundary

This layer is semantic validation only. It cannot:

- execute Manager, agents, models, tools, providers, or external actions;
- grant or widen capabilities;
- bypass Policy Runtime, confirmation, step-up, or Emergency Stop;
- clear a mandatory Critic/release gate;
- load or disclose artifact payloads.

A passing validation result means only that the verdict is structurally and semantically bound to the declared reviewed artifacts. It is not execution authority and it is not proof that the Critic conclusion is correct.
