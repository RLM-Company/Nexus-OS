#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 17 files..."
git add packages/core/src/dynamic-context-budget-allocator.ts packages/core/src/index.ts packages/db/src/cryptographic-audit-blackbox.ts apps/api/test/dynamic-budget-and-audit-blackbox.test.ts scripts/integration-dynamic-budget-and-blackbox-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_DYNAMIC_BUDGET_AND_AUDIT_BLACKBOX_2026-11-02_RU.md

echo "==> Running verification matrix (16 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 17..."
git commit -m "feat(enterprise): dynamic context budget allocator & cryptographic session audit blackbox" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 17 to GitHub!"
