#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-workflow-portability-and-fable-discovery-20261102"
PATCH_FILE="${1:-kosmora-workflow-portability-and-fable-discovery.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-workflow-portability-and-fable-discovery-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
