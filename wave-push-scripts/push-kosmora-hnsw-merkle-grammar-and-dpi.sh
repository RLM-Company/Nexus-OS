#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 22 files..."
git add packages/db/src/hnsw-vector-index.ts packages/core/src/merkle-state-trie.ts packages/core/src/constrained-grammar-enforcer.ts packages/core/src/index.ts desktop/windows/ci/dpi-coordinate-calibrator.cjs desktop/windows/test/dpi-coordinate-calibrator.test.cjs apps/api/test/hnsw-merkle-and-grammar-enforcer.test.ts scripts/integration-hnsw-merkle-grammar-and-dpi-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_HNSW_MERKLE_GRAMMAR_AND_DPI_CALIBRATOR_2026-11-02_RU.md

echo "==> Running verification matrix (21 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 22..."
git commit -m "feat(frontier): HNSW graph vector index, Merkle state trie, constrained grammar enforcer & multi-monitor DPI coordinate calibrator" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 22 to GitHub!"
