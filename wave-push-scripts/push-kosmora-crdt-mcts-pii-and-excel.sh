#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 19 files..."
git add packages/db/src/crdt-memory-sync-engine.ts packages/core/src/mcts-workflow-planner.ts packages/core/src/pii-redaction-firewall.ts packages/core/src/index.ts desktop/windows/workspace/excel-workbook-builder.cjs desktop/windows/test/excel-workbook-builder.test.cjs apps/api/test/crdt-mcts-and-pii-firewall.test.ts scripts/integration-crdt-mcts-pii-and-excel-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_CRDT_MCTS_PII_AND_EXCEL_BUILDER_2026-11-02_RU.md

echo "==> Running verification matrix (18 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 19..."
git commit -m "feat(frontier): HLC CRDT memory sync, MCTS lookahead planner, PII redaction firewall & OpenXML Excel/CSV builder" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 19 to GitHub!"
