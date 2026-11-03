#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-vault-bridge-search-and-emergency-snapshot-20261102"
PATCH_FILE="${1:-kosmora-vault-bridge-search-and-emergency-snapshot.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-vault-bridge-search-and-emergency-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
