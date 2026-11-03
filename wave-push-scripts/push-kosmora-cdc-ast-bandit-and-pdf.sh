#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 21 files..."
git add packages/db/src/cdc-chunking-deduplicator.ts packages/core/src/ast-code-sandbox-verifier.ts packages/core/src/thompson-sampling-bandit-router.ts packages/core/src/index.ts desktop/windows/workspace/pdf-report-builder.cjs desktop/windows/test/pdf-report-builder.test.cjs apps/api/test/cdc-ast-and-bandit-router.test.ts scripts/integration-cdc-ast-bandit-and-pdf-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_CDC_AST_SANDBOX_BANDIT_AND_PDF_BUILDER_2026-11-02_RU.md

echo "==> Running verification matrix (20 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 21..."
git commit -m "feat(frontier): rolling-hash CDC deduplicator, AST code sandbox verifier, Thompson sampling bandit router & native PDF 1.4 builder" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 21 to GitHub!"
