#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/kosmora-nextgen-frontier-technologies-20261102"
PATCH_FILE="${1:-kosmora-nextgen-frontier-technologies.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Running master verification matrix across all 12 suites..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"