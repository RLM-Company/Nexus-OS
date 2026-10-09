import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { verifyBackup } from "./sqlite-backup.mjs";

// Offline operator recovery only. The HTTP clearance endpoint deliberately
// refuses environment stops; this command runs with the API stopped, a verified
// backup and the environment switch already disabled. It preserves the same
// exact-activation comparison and append-only clearance audit as owner recovery.
export function recoverEnvironmentStop(database, input) {
  if (
    input.apiStopped !== "1" ||
    input.runtimeEmergencyStop !== "false" ||
    input.acknowledgement !== "CLEAR ENVIRONMENT STOP OFFLINE" ||
    typeof input.expectedActivatedAt !== "string" ||
    !Number.isFinite(Date.parse(input.expectedActivatedAt)) ||
    typeof input.ownerId !== "string" ||
    !input.ownerId.trim() ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 500
  )
    throw new Error(
      "Offline recovery requires stopped API, disabled switch and exact acknowledgement"
    );
  database.exec("BEGIN IMMEDIATE");
  try {
    const owner = database
      .prepare(
        "SELECT actor_id FROM identity_actors WHERE actor_id = ? AND owner_id = ? AND kind = 'owner' AND status = 'active'"
      )
      .get(input.ownerId, input.ownerId);
    if (!owner) throw new Error("Offline recovery requires a registered active owner");
    const active = database
      .prepare("SELECT * FROM emergency_stops WHERE scope_key = 'process' AND active = 1")
      .get();
    if (
      !active ||
      active.scope !== "process" ||
      active.project_id !== null ||
      active.activated_by !== "system:environment" ||
      active.activated_at !== input.expectedActivatedAt
    ) {
      throw new Error("Environment stop activation changed or is no longer active");
    }
    const event = {
      event_id: randomUUID(),
      owner_id: input.ownerId,
      scope: "process",
      project_id: null,
      activation_reason: active.reason,
      activated_at: active.activated_at,
      activated_by: active.activated_by,
      clearance_reason: input.reason.trim(),
      cleared_at: new Date().toISOString(),
      cleared_by: input.ownerId
    };
    const result = database
      .prepare(
        "UPDATE emergency_stops SET active = 0, cleared_at = ?, cleared_by = ? WHERE scope_key = 'process' AND active = 1 AND activated_at = ? AND activated_by = 'system:environment'"
      )
      .run(event.cleared_at, event.cleared_by, event.activated_at);
    if (Number(result.changes) !== 1) throw new Error("Environment stop changed during recovery");
    database
      .prepare(
        "INSERT INTO emergency_stop_clearance_events (event_id, owner_id, scope_key, scope, project_id, activation_reason, activated_at, activated_by, clearance_reason, cleared_at, cleared_by) VALUES (?, ?, 'process', 'process', NULL, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        event.event_id,
        event.owner_id,
        event.activation_reason,
        event.activated_at,
        event.activated_by,
        event.clearance_reason,
        event.cleared_at,
        event.cleared_by
      );
    database.exec("COMMIT");
    return event;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = process.env.COSMORA_RECOVERY_BACKUP;
  if (!manifest || !manifest.startsWith("/run/cosmora-backups/"))
    throw new Error("A private verified backup is required");
  const backup = await verifyBackup(manifest);
  const age = Date.now() - Date.parse(backup.created_at);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000)
    throw new Error("Recovery backup must be less than one hour old");
  const file = process.env.DATABASE_URL;
  if (!file?.startsWith("file:/var/lib/cosmora/")) throw new Error("Use the hosted SQLite volume");
  const database = new DatabaseSync(file.slice(5), { timeout: 5000 });
  try {
    const event = recoverEnvironmentStop(database, {
      apiStopped: process.env.COSMORA_API_STOPPED,
      runtimeEmergencyStop: process.env.RUNTIME_EMERGENCY_STOP,
      acknowledgement: process.env.COSMORA_RECOVERY_ACK,
      expectedActivatedAt: process.env.COSMORA_RECOVERY_ACTIVATION,
      ownerId: process.env.COSMORA_RECOVERY_OWNER,
      reason: process.env.COSMORA_RECOVERY_REASON
    });
    console.log(
      `Offline environment-stop recovery PASS; audit event ${event.event_id}. No model request sent.`
    );
  } finally {
    database.close();
  }
}
