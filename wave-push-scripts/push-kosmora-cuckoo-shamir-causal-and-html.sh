#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-cuckoo-shamir-causal-and-html-20261103"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

git add \
  packages/db/migrations/0063_unified_stage2_extensions.sql \
  packages/db/src/cuckoo-and-bloom-filter-index.ts \
  packages/core/src/shamir-secret-sharing-escrow.ts \
  packages/core/src/causal-counterfactual-attribution.ts \
  packages/core/src/index.ts \
  desktop/windows/workspace/interactive-report-bundle-builder.cjs \
  apps/api/test/cuckoo-shamir-and-causal-engine.test.ts \
  desktop/windows/test/interactive-report-bundle-builder.test.cjs \
  scripts/integration-cuckoo-shamir-causal-and-html-smoke.mjs \
  scripts/stage2-master-verification-matrix-runner.mjs \
  docs/handoff/KOSMORA_CUCKOO_SHAMIR_CAUSAL_AND_HTML_BUNDLE_2026-11-03_RU.md

node scripts/integration-cuckoo-shamir-causal-and-html-smoke.mjs
node scripts/check-secrets.mjs

git commit -m "feat(stage2): add Cuckoo/Bloom filter index, Shamir (k,n) secret sharing over GF(256), Causal SCM attribution, and HTML5/SVG report builder"
git push -u origin "$BRANCH"
