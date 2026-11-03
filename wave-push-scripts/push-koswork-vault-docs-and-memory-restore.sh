#!/usr/bin/env bash
set -euo pipefail

BRANCH="feature/koswork-vault-docs-and-memory-restore-20261101"
PATCH_FILE="${1:-koswork-vault-docs-and-memory-restore.patch}"

echo "==> Checking out branch ${BRANCH}..."
git checkout -B "${BRANCH}"

echo "==> Applying patch ${PATCH_FILE}..."
git am "${PATCH_FILE}" || git apply --index "${PATCH_FILE}"

echo "==> Applying idempotent CI remediation for PR #420 and PR #424 (if present in branch)..."
node scripts/remediate-memory-and-vault-ci.mjs --apply

echo "==> Running integration & unit verification..."
node scripts/integration-vault-memory-smoke.mjs

echo "==> Pushing branch ${BRANCH} to origin..."
git push -u origin "${BRANCH}"