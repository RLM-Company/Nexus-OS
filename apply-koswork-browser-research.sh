#!/usr/bin/env bash
set -euo pipefail

# One-Command Branch Installer & Verifier for `gemini/koswork-browser-research`
# Owner: Gemini | Target Repo: https://github.com/RLM-Company/Nexus-OS
# Plan Control Base SHA: 338536ee5946f96dcd18768143cc41af998c476a

BRANCH_NAME="gemini/koswork-browser-research"
EXPECTED_BASE_SHA="338536ee5946f96dcd18768143cc41af998c476a"

echo "==> [1/4] Checking current git repository state and remotes..."
CURRENT_SHA="$(git rev-parse HEAD)"
echo "Current HEAD SHA: ${CURRENT_SHA}"
echo "Plan Control Base SHA: ${EXPECTED_BASE_SHA}"
git remote -v || true

echo "==> [2/4] Creating / switching to branch ${BRANCH_NAME}..."
git checkout -B "${BRANCH_NAME}"

echo "==> [3/4] Running Koswork Browser Research end-to-end verification suite..."
node scripts/integration-koswork-browser-research-smoke.mjs

echo "==> [4/4] Verification succeeded on branch ${BRANCH_NAME}."
echo "NOTE: Before pushing, inspect 'git remote -v' to ensure 'origin' points to https://github.com/RLM-Company/Nexus-OS rather than a local mirror."
