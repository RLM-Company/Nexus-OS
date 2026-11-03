#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-pq-kalman-zk-and-archive-20261103"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

git add \
  packages/db/migrations/0063_unified_stage2_extensions.sql \
  packages/db/src/product-quantization-vector-codec.ts \
  packages/core/src/kalman-cusum-drift-detector.ts \
  packages/core/src/zk-commitment-verifier.ts \
  packages/core/src/index.ts \
  desktop/windows/ci/archive-quarantine-verifier.cjs \
  apps/api/test/pq-kalman-and-zk-verifier.test.ts \
  desktop/windows/test/archive-quarantine-verifier.test.cjs \
  scripts/integration-pq-kalman-zk-and-archive-smoke.mjs \
  scripts/stage2-master-verification-matrix-runner.mjs \
  docs/handoff/KOSMORA_PQ_KALMAN_ZK_AND_ARCHIVE_QUARANTINE_2026-11-03_RU.md

node scripts/integration-pq-kalman-zk-and-archive-smoke.mjs
node scripts/check-secrets.mjs

git commit -m "feat(stage2): add Product Quantization 32x vector codec, Kalman-CUSUM drift detector, Zero-Knowledge commitments, and Archive Quarantine guard"
git push -u origin "$BRANCH"
