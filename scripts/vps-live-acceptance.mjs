#!/usr/bin/env node
// Live acceptance signs in to create an owner session, then reads service state.
// No model request, deployment, or service restart. Requires an explicit owner password
// in the environment; the password is never printed or written to disk.
//
//   KOSMORA_OWNER_PASSWORD=... node scripts/vps-live-acceptance.mjs
//
// Reuses deploy/alpha/verify-access.mjs (the same checks the deploy runbook
// uses): unauthenticated 303/401, form login, protected interface assets,
// /api/v1/health with SQLite ok, owner session and operations status.
import { verifyAccess } from "../deploy/alpha/verify-access.mjs";

const ORIGIN = "https://169.40.37.32";
const password = process.env.KOSMORA_OWNER_PASSWORD;

if (!password) {
  process.stderr.write(
    "KOSMORA_OWNER_PASSWORD is not set. Ask the owner for the /__owner/login password.\n"
  );
  process.exit(2);
}

try {
  const result = await verifyAccess({
    origin: ORIGIN,
    password,
    authMode: "form",
    closeFormSession: true
  });
  process.stdout.write(
    JSON.stringify(
      {
        origin: ORIGIN,
        scope: "temporary owner login, health/session/assets checks and logout; no model request",
        ok: true,
        session_expires_at: result.session_expires_at,
        model_requests_paused: result.model_requests_paused
      },
      null,
      2
    ) + "\n"
  );
} catch (error) {
  process.stderr.write(
    `Owner access FAIL: ${error instanceof Error ? error.message : "verification failed"}.\n`
  );
  process.exitCode = 1;
}
