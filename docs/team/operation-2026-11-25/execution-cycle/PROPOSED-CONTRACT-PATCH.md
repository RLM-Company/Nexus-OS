# Proposed contract patch for #664 (for integrator review)

Branch `codex/supplier-cycle-proposed` is based on candidate #664 head
`daa34066188fb28f4e4ebd9854aba70e20022354`. It contains **only a proposed
contract addition**; it is not intended to be merged into main directly.

## Exact change

`packages/contracts/src/manager-work.ts`:

- add `WorkExecutionCycle` interface with
  `stage | version | question | gaps | instructions | error_code |
 accepted_inputs | result_ref`;
- add optional `execution_cycle?: WorkExecutionCycle` to `ManagerWork`.

No raw source bytes are copied into the new field: `accepted_inputs` references
the immutable `supplier_handoff.inputs` by name and SHA-256; `result_ref`
references an existing saved report, not inline CSV/Markdown.

## CAS and lifecycle contract

1. `version` changes on every question/answer/control event; a stale event with
   an older version must be rejected with 409 (same pattern as other control
   commands).
2. `pause` keeps `question` and `gaps`; `resume` restores the previous stage.
3. `error_code` is cleared only by a successful correction/new instruction.
4. `instructions` are append-only.
5. `cancel` is terminal; `result_ref` and `accepted_inputs` remain readable.

## Relationship to #664 fields

`input_sha256`, `source_files`, `checks[]`, `disputes[]`,
`applied_rule_versions` and `ignored_rules` are left unchanged. The new field
is purely an execution-cycle overlay on the same Work.

## Local check

```
prettier --check packages/contracts/src/manager-work.ts → 0
```

After integrator confirmation, the next step is wiring the existing core state
machine (`@cosmora/core` from #666/#670) into API/UI through this field and
running the full Koswork acceptance from `scripts/koswork-supplier-full-run.mjs`.
