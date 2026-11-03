#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/working_dir/c_d914abe13b51decb/kosmora-windows-repo"
cd "$REPO_DIR"

echo "==> Pulling latest remote changes..."
git pull --rebase origin feature/kosmora-self-healing-and-knowledge-graph-20261102 || true

echo "==> Staging Wave 18 files..."
git add packages/db/src/episodic-reflexion-engine.ts packages/core/src/claim-grounding-verifier.ts packages/core/src/index.ts desktop/windows/browser/visual-dom-diff-verifier.cjs desktop/windows/test/visual-dom-diff-verifier.test.cjs apps/api/test/reflexion-and-grounding-verifier.test.ts scripts/integration-reflexion-grounding-and-dom-diff-smoke.mjs scripts/stage2-master-verification-matrix-runner.mjs docs/handoff/KOSMORA_REFLEXION_GROUNDING_AND_DOM_DIFF_2026-11-02_RU.md

echo "==> Running verification matrix (17 suites)..."
node scripts/stage2-master-verification-matrix-runner.mjs

echo "==> Committing Wave 18..."
git commit -m "feat(cognition): episodic reflexion engine, claim grounding verifier & visual DOM diff detector" || true

echo "==> Pushing to origin..."
git push origin feature/kosmora-self-healing-and-knowledge-graph-20261102

echo "🎉 Successfully pushed Wave 18 to GitHub!"
