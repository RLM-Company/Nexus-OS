import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

/**
 * Reproducible release candidate from an exact source SHA.
 *
 * Refuses to build from a dirty tree and refuses to build a commit different
 * from the one requested. The archive is byte-stable for a given commit and
 * toolchain: mtimes, ownership and ordering are normalized. No network, no
 * secrets, no database writes. Output must live outside the checkout.
 */
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
  throw new Error(
    "Usage: node scripts/build-release.mjs <exact-40-hex-sha> <absolute-output-directory> [label]"
  );
}
const [commit, outputArgument, labelArgument] = args;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected an exact 40-hex source commit.");
if (!outputArgument || !isAbsolute(outputArgument)) {
  throw new Error("Release output must be an absolute directory outside the checkout.");
}
const output = resolve(outputArgument);
const relativeOutput = relative(root, output);
if (
  !(
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutput)
  )
) {
  throw new Error("Release output must be outside the source checkout.");
}
const label = labelArgument ?? `rc-${commit.slice(0, 12)}`;
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(label)) {
  throw new Error("Label must be a lowercase slug (letters, digits, '.', '_', '-').");
}

const git = (params) =>
  execFileSync("git", params, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * Read every blob for a commit in one `git cat-file --batch` process. Spawning
 * one `git show` per file costs ~90 ms on Windows and makes the build take
 * minutes; batching keeps a 3300-file snapshot under a second.
 */
const readAllBlobs = (commitName, paths, onBlob) => {
  const input = paths.map((path) => `${commitName}:${path}\n`).join("");
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input,
    maxBuffer: 512 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error("git cat-file --batch failed");
  let cursor = 0;
  let total = 0;
  const buffer = result.stdout;
  for (let index = 0; index < paths.length; index++) {
    const newline = buffer.indexOf(0x0a, cursor);
    if (newline === -1) throw new Error("Truncated cat-file header");
    const header = buffer.subarray(cursor, newline).toString("ascii").split(" ");
    cursor = newline + 1;
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isInteger(size)) {
      throw new Error(`Unexpected object for ${paths[index]}: ${header.join(" ")}`);
    }
    const bytes = buffer.subarray(cursor, cursor + size);
    cursor += size;
    if (buffer[cursor] !== 0x0a) throw new Error("Truncated cat-file payload");
    cursor += 1;
    total += size;
    onBlob(index, bytes);
  }
  return total;
};

if (git(["status", "--porcelain"]).trim()) {
  throw new Error("Commit or preserve source changes before building a release candidate.");
}
const head = git(["rev-parse", "HEAD"]).trim();
if (head !== commit) {
  throw new Error(`Exact-SHA violation: HEAD is ${head}, requested ${commit}.`);
}
execFileSync(process.execPath, ["scripts/check-secrets.mjs"], { cwd: root, stdio: "inherit" });

const names = git(["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean);
const tree = git(["ls-tree", "-r", "-z", commit]).split("\0").filter(Boolean);
if (tree.some((entry) => !/^100(?:644|755) blob /u.test(entry))) {
  throw new Error("Release must contain regular source files only, without links or submodules.");
}
for (const name of names) {
  if (
    name.split("/").some((part) => part === ".." || part === "node_modules" || part === ".git") ||
    /(?:^|\/)\.env(?:$|\.(?!example$))/u.test(name) ||
    /\.(?:pem|key|db|db-wal|db-shm|sqlite|sqlite3)$/iu.test(name) ||
    /^(?:qa|\.tmp)\//u.test(name)
  ) {
    throw new Error(`Non-source entry refused: ${name}`);
  }
}

// Modes come from the same ls-tree entries used for validation; path order is
// identical to `names`, so index alignment is guaranteed.
const modes = tree.map((entry) => (entry.startsWith("100755") ? 0o755 : 0o644));
const entries = names.map((path, index) => ({ path, mode: modes[index], bytes: null, sha256: "" }));
readAllBlobs(commit, names, (index, bytes) => {
  entries[index].bytes = bytes;
  entries[index].sha256 = createHash("sha256").update(bytes).digest("hex");
});
const sourceBytes = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
const FILE_LIMIT = 64 * 1024 * 1024;
if (sourceBytes > FILE_LIMIT) throw new Error("Source snapshot exceeds release bound.");

const migrations = JSON.parse(git(["show", `${commit}:packages/db/migrations/meta/_journal.json`]));
const directory = resolve(output, `kosmora-linux-x64-${label}`);
if (existsSync(directory)) throw new Error("Release directory already exists; refusing overwrite.");
mkdirSync(directory, { recursive: true });

// Deterministic tar.gz: fixed order, weights when present, fixed mtime/uid/gid,
// fixed gzip header with no filename and no OS byte. SHA-256 is stable across builds.
const TAR_MTIME = 0;
const staged = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

// USTAR supports a 155-byte prefix plus a 100-byte name; split at a '/' so
// deep repository paths (e.g. docs/handoff/...) remain representable.
const splitPath = (name) => {
  if (Buffer.byteLength(name) <= 100) return { prefix: "", name };
  const bytes = Buffer.from(name, "utf8");
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x2f) {
      const prefixBytes = bytes.subarray(0, i);
      const nameBytes = bytes.subarray(i + 1);
      if (prefixBytes.length <= 155 && nameBytes.length <= 100) {
        return { prefix: prefixBytes.toString("utf8"), name: nameBytes.toString("utf8") };
      }
    }
  }
  throw new Error(`Path exceeds tar prefix/name limits: ${name}`);
};
const blocks = [];
const header = (fullName, size, mode, type) => {
  const { prefix, name } = splitPath(fullName);
  const buffer = Buffer.alloc(512, 0);
  buffer.write(name, 0, 100, "utf8");
  buffer.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "ascii");
  buffer.write("0".padStart(7, "0") + "\0", 108, 8, "ascii");
  buffer.write("0".padStart(7, "0") + "\0", 116, 8, "ascii");
  buffer.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  buffer.write(TAR_MTIME.toString(8).padStart(11, "0") + "\0", 136, 12, "ascii");
  const check = " ".repeat(8);
  buffer.write(check, 148, 8, "ascii");
  buffer.write(type, 156, 1, "ascii");
  buffer.write("ustar\0", 257, 6, "ascii");
  buffer.write("00", 263, 2, "ascii");
  if (prefix) buffer.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of buffer) sum += byte;
  buffer.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return buffer;
};
const pad = (bytes) => (512 - (bytes.length % 512)) % 512;
const archivePathOf = (name) => `kosmora-${commit.slice(0, 12)}/${name}`;
for (const file of staged) {
  const name = archivePathOf(file.path);
  if (Buffer.byteLength(name) > 100) throw new Error(`Path exceeds tar name limit: ${name}`);
  blocks.push(header(name, file.bytes.length, file.mode, "0"));
  blocks.push(file.bytes);
  if (file.bytes.length % 512) blocks.push(Buffer.alloc(pad(file.bytes)));
}
blocks.push(Buffer.alloc(1024));
const tar = Buffer.concat(blocks);

// gzip without timestamp, filename or OS fields (deflate level 9, deterministic in Node).
const { deflateSync } = await import("node:zlib");
const deflated = deflateSync(tar, { level: 9 });
const gzipHeader = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03]);
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
let crc = 0xffffffff;
for (const byte of tar) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
const trailer = Buffer.alloc(8);
trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0);
trailer.writeUInt32LE(tar.length >>> 0, 4);
const archive = Buffer.concat([gzipHeader, deflated, trailer]);
const archiveName = "source.tar.gz";
writeFileSync(resolve(directory, archiveName), archive);

const manifest = {
  format: "kosmora-linux-x64-release-v1",
  label,
  commit,
  source_files: entries.length,
  source_bytes: sourceBytes,
  toolchain: {
    node_package_engine: "node:24-bookworm-slim",
    pnpm: "11.19.0",
    tar_mtime_unix: TAR_MTIME,
    gzip: "level=9, no mtime/name/os"
  },
  archive: {
    name: archiveName,
    bytes: archive.length,
    sha256: createHash("sha256").update(archive).digest("hex")
  },
  migrations: migrations.entries.map(({ idx, tag }) => ({ idx, tag })),
  production_deployed: false,
  files: entries.map(({ path, bytes, sha256 }) => ({ path, bytes: bytes.length, sha256 }))
};
writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
  flag: "wx"
});
process.stdout.write(
  JSON.stringify({ directory, label, commit, files: entries.length, archive: manifest.archive }, null, 2) +
    "\n"
);
