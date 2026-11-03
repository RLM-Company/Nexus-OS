#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 20 files..."
git add desktop/windows/workspace/powerpoint-deck-builder.cjs desktop/windows/test/powerpoint-deck-builder.test.cjs packages/db/src/temporal-knowledge-graph.ts packages/core/src/prompt-injection-shield.ts packages/core/src/adaptive-circuit-breaker.ts packages/core/src/index.ts apps/api/test/temporal-kg-injection-and-circuit-breaker.test.ts scripts/integration-pptx-temporal-kg-and-shield-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_PPTX_TEMPORAL_KG_AND_SECURITY_SHIELD_2026-11-02_RU.md

echo "==> Running verification matrix (19 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 20..."
git commit -m "feat(frontier): OpenXML PowerPoint (.pptx) builder, bitemporal knowledge graph, prompt injection shield & adaptive circuit breaker" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 20 to GitHub!"
