#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-roaring-dp-petri-and-wav-20261103"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

git add \
  packages/db/migrations/0063_unified_stage2_extensions.sql \
  packages/db/src/roaring-positional-inverted-index.ts \
  packages/core/src/differential-privacy-telemetry.ts \
  packages/core/src/petri-net-workflow-verifier.ts \
  packages/core/src/index.ts \
  desktop/windows/ci/wav-pcm-audio-verifier.cjs \
  apps/api/test/roaring-dp-and-petri-net.test.ts \
  desktop/windows/test/wav-pcm-audio-verifier.test.cjs \
  scripts/integration-roaring-dp-petri-and-wav-smoke.mjs \
  scripts/stage2-master-verification-matrix-runner.mjs \
  docs/handoff/KOSMORA_ROARING_DP_PETRI_AND_WAV_VERIFIER_2026-11-03_RU.md

node scripts/integration-roaring-dp-petri-and-wav-smoke.mjs
node scripts/check-secrets.mjs

git commit -m "feat(stage2): add Roaring Bitmap positional index, Differential Privacy telemetry, Petri Net workflow verifier, and WAV PCM audio verifier"
git push -u origin "$BRANCH"