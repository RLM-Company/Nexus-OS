#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 16 files..."
git add packages/core/src/speculative-tool-router.ts packages/core/src/index.ts apps/api/test/speculative-tool-router.test.ts scripts/driver-mock-gateway-live-e2e.mjs scripts/benchmark-kosmora-stage2-performance.mjs scripts/integration-nextgen-technologies-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_SPECULATIVE_ROUTING_AND_PRODUCTION_SIMULATION_2026-11-02_RU.md

echo "==> Running verification matrix (15 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 16..."
git commit -m "feat(frontier): streaming speculative tool router, live production simulation driver & automated performance benchmarks" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 16 to GitHub!"
