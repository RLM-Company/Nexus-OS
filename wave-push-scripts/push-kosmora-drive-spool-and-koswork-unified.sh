#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-drive-spool-and-koswork-unified-20261102"
PATCH_FILE="${1:-kosmora-drive-spool-and-koswork-unified.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-drive-spool-and-koswork-report-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
