#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-stage2-migration-privacy-and-ipc-20261102"
PATCH_FILE="${1:-kosmora-stage2-migration-privacy-and-ipc.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running Stage-2 migration, privacy fence, IPC bridge & boundary verification..."
node scripts/run-all-stage2-acceptance-suites.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"