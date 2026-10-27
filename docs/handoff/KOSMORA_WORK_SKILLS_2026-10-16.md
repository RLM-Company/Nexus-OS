# Personal Skills in Work — 16 October 2026

Project Work now has an explicit pinned selection independent of ordinary chat. Admission snapshots are inserted in the same SQLite transaction as the work or graph and its checkpoint. A saved graph freezes one selection for all nodes and later explicit retries; catalog edits/deletion and later project selection changes cannot alter those instructions. Pre-migration graphs and tasks remain empty, including new attempts of a legacy graph. Snapshot tables reject UPDATE, retain text independently of catalog FKs, and cascade with their canonical parent.

Every planning/drafting/review request reads the accepted work snapshot, embeds it as JSON user context and counts the complete input through existing token/budget admission. No permissions, tools, automatic retries or model calls are added by selection, preview, copy or read-only recovery. System prompts preserve role-specific authority and review boundaries.

The shared chat/Work selector retains optimistic conflicts and one-write/read-only lost-response recovery. A read-only literal preview displays the exact instructions for each saved plan/task. Project selection can change while work runs; the visible explanation limits this to future admissions. Migration 0047 follows 0046 without rewriting journal history. Work privacy exports settings, selections and both snapshot tables; deletion removes them regardless of catalog-adapter ordering. Existing global and local owner fences apply.

Validation is recorded in the final continuation handoff. Live model quality, paid requests, server deployment and hosted CI are outside the local verification.
