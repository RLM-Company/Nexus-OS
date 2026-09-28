import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { IdentityStore, openDatabase, runMigrations } from "../../packages/db/dist/index.js";

const output = process.env.COSMORA_SESSION_FILE;
if (!output || !output.startsWith("/run/cosmora/")) {
  throw new Error("COSMORA_SESSION_FILE must be under /run/cosmora/");
}
const rotating = process.env.COSMORA_ROTATE_SESSION === "1";
if (existsSync(output) && !rotating) {
  throw new Error("Session file already exists; use COSMORA_ROTATE_SESSION=1 to rotate");
}
const database = openDatabase(process.env.DATABASE_URL ?? "file:/var/lib/cosmora/cosmora.db");
try {
  await runMigrations(database);
  const store = new IdentityStore(database.sqlite);
  const owner = "hosted-alpha-owner";
  store.registerActor(owner, owner, "owner");
  const oldToken = existsSync(output)
    ? /^COSMORA_OWNER_SESSION_TOKEN=([^\r\n]+)$/m.exec(readFileSync(output, "utf8"))?.[1]
    : null;
  const oldSession = oldToken ? store.resolveSession(oldToken) : null;
  const { token, session } = store.issueSession({
    ownerId: owner,
    actorId: owner,
    assurance: "single_factor",
    ttlMs: 7 * 24 * 60 * 60 * 1000
  });
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.new`;
  writeFileSync(temporary, `COSMORA_OWNER_SESSION_TOKEN=${token}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, output);
  if (oldSession) {
    store.revokeSession(oldSession.session_id, owner, owner, "Hosted alpha session rotation");
  }
  process.stdout.write(
    `Owner session saved; expires ${session.expires_at}. Token was not printed.\n`
  );
} finally {
  database.close();
}
