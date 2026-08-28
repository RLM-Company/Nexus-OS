# ADR-004: Agent Studio and modular agent composition

**Date:** 2026-08-26  
**Status:** OWNER APPROVED SPECIFICATION / CONTRACTS IMPLEMENTED / NOT RUNTIME

## Context

Cosmora AI must be able to assemble a project-specific team without turning every agent into a
permanent persona with one inseparable role prompt. A role, a way of working, a model choice and
the authority to act are separate concerns and must remain replaceable independently.

The owner must be able to use approved behaviour patterns, create their own patterns and ask the
Manager to propose or assemble a team. User-authored instructions must never bypass the
Constitution, project mandate, policy decisions or tool permissions.

## Decision

### 1. Agent composition

Every active agent is a project-bound instance assembled from six independently versioned parts:

1. **Function** — its mission, required result format and quality contract; for example,
   researcher, analyst, architect, executor or critic.
2. **Behaviour pattern** — a reusable working style; for example, critical analyst, creative
   strategist, strict executor, editor, sales specialist or red-team reviewer.
3. **Model profile** — the selected Cosmora intelligence profile and a verified provider route.
4. **Tool and permission scope** — the minimum set of permitted tools, integrations, data and
   action boundaries.
5. **Memory scope** — the project data, task context and retained outputs that the agent may use.
6. **Lifecycle and budget** — start condition, task or milestone, expiry, token/cost limits and
   close conditions.

An agent's function is not its identity. The same researcher function may use different behaviour
patterns and models in different projects. Conversely, a behaviour pattern may be used by several
functions when their authority and output contracts remain distinct.

### 2. Instruction precedence

At runtime the agent instruction is composed in this order, from highest to lowest priority:

1. immutable Constitution, law and platform safety rules;
2. active autonomy profile, project passport, owner prohibitions and Policy Engine decisions;
3. function contract, tool scope, data scope, budget and lifecycle;
4. selected behaviour pattern;
5. task-specific instructions and supplied working material.

Custom patterns are therefore scoped behaviour modules, not raw replacement system prompts. A
pattern that conflicts with a higher layer is rejected or has the conflicting part removed, and
the decision is recorded.

### 3. Pattern Library

Agent Studio contains a versioned Pattern Library with:

- product-approved patterns;
- owner-created and owner-uploaded patterns;
- project-only patterns; and
- archived patterns retained for reproducibility of completed work.

Every pattern has an author, version, description, allowed functions, known limitations and a
test status. It may be previewed against representative tasks before it is activated. Uploading a
pattern never grants a tool, data, budget or autonomy permission.

### 4. Team creation and lifecycle

The owner may manually create, edit, pause, replace or close agents in Agent Studio. The Manager
may propose a team for a goal and explain the function, pattern, model profile, permissions,
budget and expected output of each member.

Active agents are normally temporary: they receive a bounded task or milestone, report their
result and evidence, and are then accepted, revised, replaced or closed by the Manager. Before a
replacement, the Manager preserves useful outputs, open questions, errors and a concise handoff
summary. Completed results enter project memory; closed agents lose their working access.

Permanent core functions are an exception and require an explicit approved specification. The
Manager and the independent critic remain governed by their separate constitutional requirements.

### 5. Authority by autonomy level

- **A0–A1:** the Manager may design or simulate a team, but no agent performs independent tool or
  external work.
- **A2–A4:** the Manager may create temporary project agents from approved functions and patterns
  when their actual tools and actions are already permitted by the active project settings. New
  permanent prompts/patterns require the owner's approval. All creations, changes and closures
  enter the Decision Trace.
- **A5:** within the approved project passport, the Manager may freely create, connect, replace,
  pause and close project agents, select their models and redistribute work. It may use only the
  passport's permitted roles, tools, data, budget and external-action boundaries.
- **A6:** creation of permanent patterns or broader agent types is autonomous only when the owner
  has explicitly included that category in the A6 grant. Constitutional rules, the initial mandate,
  logging and emergency stop remain in force.

Creating an agent never expands any permission. Delegation is always constrained by the source
mandate and may not silently grant a subagent access to data, tools, budget or external actions
that its creator does not possess.

## Consequences

Cosmora can use a compact, understandable user interface while retaining a flexible internal
team. The user chooses a ready-made team, builds one manually, or asks the Manager to assemble
one; each path produces the same auditable composed-agent record.

Implementation work will introduce a pattern registry, agent-instance registry, instruction
composer, lifecycle events and Agent Studio UI. This ADR does not authorise their runtime
implementation or change existing A0–A6 permissions by itself.

## Contract implementation boundary

The shared contracts now represent function definitions, behaviour patterns, immutable composition
blueprints, bounded grants, memory scope, lifecycle state and replacement handoffs. Pattern content
cannot carry capability, tool, data or budget fields. A pure Policy Engine validator rejects any
child blueprint that changes owner/project, expands capabilities/tools/data/objects/budget/expiry,
or fails to reduce delegation depth.

These contracts are not an Agent Registry, instruction composer, final Manager prompt or runtime
permission. Persisting, activating and executing an agent remain later gated increments.
