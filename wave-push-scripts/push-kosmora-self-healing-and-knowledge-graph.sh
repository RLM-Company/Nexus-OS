#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-self-healing-and-knowledge-graph-20261102"
PATCH_FILE="${1:-kosmora-self-healing-and-knowledge-graph.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running master verification matrix across all 13 suites..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
