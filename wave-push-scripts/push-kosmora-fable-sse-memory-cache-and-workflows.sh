#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-fable-sse-memory-cache-and-workflows-20261102"
PATCH_FILE="${1:-kosmora-fable-sse-memory-cache-and-workflows.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-fable-memory-cache-and-workflows-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
