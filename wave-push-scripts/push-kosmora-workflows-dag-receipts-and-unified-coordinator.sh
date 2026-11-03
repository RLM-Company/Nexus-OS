#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-workflows-dag-receipts-and-unified-coordinator-20261102"
PATCH_FILE="${1:-kosmora-workflows-dag-receipts-and-unified-coordinator.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-workflow-dag-receipts-and-unified-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"