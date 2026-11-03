#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-hybrid-memory-and-migration-20261101"
PATCH_FILE="${1:-kosmora-hybrid-memory-and-migration.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-hybrid-memory-and-download-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
