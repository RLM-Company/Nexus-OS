import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

// Only hashes of random session tokens are stored. A password change invalidates
// the saved sessions; the password and raw browser cookies never enter this file.
export function createOwnerSessionStore({ file, scope }) {
  if (file && !isAbsolute(file)) throw new Error("Owner session file must be absolute");
  let sessions = new Map();
  if (file) {
    try {
      const raw = readFileSync(file, "utf8");
      if (raw.length > 65536) throw new Error("Owner session store is too large");
      const data = JSON.parse(raw);
      if (
        data.version !== 1 ||
        typeof data.scope !== "string" ||
        !Array.isArray(data.sessions) ||
        data.sessions.length > 128 ||
        data.sessions.some(
          (entry) =>
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string" ||
            !/^[a-f0-9]{64}$/.test(entry[0]) ||
            !Number.isSafeInteger(entry[1]) ||
            entry[1] <= 0
        )
      )
        throw new Error("Invalid owner session store");
      if (data.scope === scope) sessions = new Map(data.sessions);
      chmodSync(file, 0o600);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return {
    read: () => new Map(sessions),
    save(next) {
      if (file) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        chmodSync(dirname(file), 0o700);
        const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          writeFileSync(
            temporary,
            JSON.stringify({ version: 1, scope, sessions: [...next] }) + "\n",
            { mode: 0o600, flag: "wx" }
          );
          renameSync(temporary, file);
        } finally {
          try {
            unlinkSync(temporary);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
      }
      sessions = new Map(next);
    }
  };
}
