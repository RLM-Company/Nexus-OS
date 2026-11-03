#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-compaction-profile-and-vps-recovery-20261102"
PATCH_FILE="${1:-kosmora-compaction-profile-and-vps-recovery.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running integration & unit verification..."
node scripts/integration-compaction-profile-and-vps-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"
