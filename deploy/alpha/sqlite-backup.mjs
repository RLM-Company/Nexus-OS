import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const sha256 = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

const checkIntegrity = (file) => {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
      throw new Error("SQLite backup integrity check failed");
    }
  } finally {
    database.close();
  }
};

export const createBackup = async (databaseUrl, directory) => {
  if (!databaseUrl || databaseUrl === ":memory:") throw new Error("A file database is required");
  const source = realpathSync(resolve(databaseUrl.replace(/^file:/u, "")));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const outputDirectory = realpathSync(directory);
  if (outputDirectory === dirname(source)) throw new Error("Use a separate backup directory");
  chmodSync(outputDirectory, 0o700);
  const createdAt = new Date().toISOString();
  const name = `cosmora-${createdAt.replace(/[:.]/gu, "-")}-${randomUUID()}.sqlite`;
  const destination = join(outputDirectory, name);
  const temporary = `${destination}.partial`;
  const manifestPath = `${destination}.json`;
  const temporaryManifest = `${manifestPath}.partial`;
  const database = new DatabaseSync(source, { readOnly: true, timeout: 5_000 });
  try {
    writeFileSync(temporary, "", { mode: 0o600, flag: "wx" });
    // SQLite's online backup includes committed WAL data while the service remains available.
    await backup(database, temporary);
    chmodSync(temporary, 0o600);
    checkIntegrity(temporary);
    const manifest = {
      version: 1,
      created_at: createdAt,
      file: name,
      bytes: statSync(temporary).size,
      sha256: await sha256(temporary)
    };
    writeFileSync(temporaryManifest, JSON.stringify(manifest, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx"
    });
    renameSync(temporary, destination);
    renameSync(temporaryManifest, manifestPath);
    return { manifestPath, ...manifest };
  } finally {
    database.close();
    rmSync(temporary, { force: true });
    rmSync(temporaryManifest, { force: true });
  }
};

export const verifyBackup = async (manifestPath) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.version !== 1 ||
    typeof manifest.file !== "string" ||
    !/^cosmora-[\w-]+\.sqlite$/u.test(manifest.file) ||
    basename(manifest.file) !== manifest.file ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes <= 0 ||
    !/^[a-f0-9]{64}$/u.test(manifest.sha256 ?? "")
  ) {
    throw new Error("Invalid SQLite backup manifest");
  }
  const directory = realpathSync(dirname(resolve(manifestPath)));
  const file = realpathSync(join(directory, manifest.file));
  if (dirname(file) !== directory) throw new Error("Backup must remain in its manifest directory");
  if (statSync(file).size !== manifest.bytes || (await sha256(file)) !== manifest.sha256) {
    throw new Error("SQLite backup checksum mismatch");
  }
  checkIntegrity(file);
  return { ...manifest, file };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const operation = process.argv[2];
  if (operation === "create") {
    const result = await createBackup(
      process.env.DATABASE_URL ?? "file:/var/lib/cosmora/cosmora.db",
      process.env.COSMORA_BACKUP_DIRECTORY ?? "/run/cosmora-backups"
    );
    process.stdout.write(`SQLite backup verified: ${result.manifestPath}\n`);
  } else if (operation === "verify" && process.argv[3]) {
    const result = await verifyBackup(process.argv[3]);
    process.stdout.write(`SQLite backup verified: ${result.file}\n`);
  } else {
    throw new Error("Use sqlite-backup.mjs create | verify <manifest.json>");
  }
}
