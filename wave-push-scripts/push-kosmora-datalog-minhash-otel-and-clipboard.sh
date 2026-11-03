#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 23 files..."
git add packages/core/src/datalog-inference-engine.ts packages/db/src/minhash-lsh-deduplicator.ts packages/core/src/opentelemetry-trace-analyzer.ts packages/core/src/index.ts desktop/windows/ci/clipboard-and-drop-guard.cjs desktop/windows/test/clipboard-and-drop-guard.test.cjs apps/api/test/datalog-minhash-and-otel-tracer.test.ts scripts/integration-datalog-minhash-otel-and-clipboard-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_DATALOG_MINHASH_OTEL_AND_CLIPBOARD_GUARD_2026-11-03_RU.md

echo "==> Running verification matrix (22 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 23..."
git commit -m "feat(frontier): deductive Datalog engine, MinHash-LSH near-duplicate detector, W3C OpenTelemetry trace analyzer & Windows clipboard/drop guard" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 23 to GitHub!"
