import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

// Package a committed source snapshot only. No network, deployment or database writes.
const root = resolve(import.meta.dirname, "..");
const outputArgument = process.argv[2];
if (!outputArgument || !isAbsolute(outputArgument)) {
  throw new Error("Usage: node scripts/package-feature-release.mjs <absolute-output-directory>");
}
const output = resolve(outputArgument);
const relativeOutput = relative(root, output);
if (!(
  relativeOutput === ".." ||
  relativeOutput.startsWith(`..${sep}`) ||
  isAbsolute(relativeOutput)
)) {
  throw new Error("Release output must be outside the source checkout.");
}
const git = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (git(["status", "--porcelain"]).trim()) {
  throw new Error("Commit or separately preserve source changes before packaging.");
}
execFileSync(process.execPath, ["scripts/check-secrets.mjs"], { cwd: root, stdio: "inherit" });
const commit = git(["rev-parse", "HEAD"]).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid source commit.");
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
  )
    throw new Error(`Non-source entry refused: ${name}`);
}
const entries = names.map((path) => {
  const bytes = execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024
  });
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const sourceBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
if (sourceBytes > 64 * 1024 * 1024) throw new Error("Source snapshot exceeds release bound.");
const migrations = JSON.parse(git(["show", `${commit}:packages/db/migrations/meta/_journal.json`]));
const directory = resolve(output, `kosmora-features-${commit.slice(0, 12)}`);
mkdirSync(output, { recursive: true });
if (existsSync(directory)) throw new Error("Release directory already exists; refusing overwrite.");
mkdirSync(directory);
const archive = resolve(directory, "source.tar.gz");
execFileSync("git", ["archive", "--format=tar.gz", `--output=${archive}`, commit], { cwd: root });
const archiveBytes = readFileSync(archive);
const manifest = {
  format: "kosmora-source-release-v1",
  commit,
  source_files: entries.length,
  source_bytes: sourceBytes,
  archive: {
    name: "source.tar.gz",
    bytes: archiveBytes.length,
    sha256: createHash("sha256").update(archiveBytes).digest("hex")
  },
  migrations: migrations.entries.map(({ idx, tag }) => ({ idx, tag })),
  production_deployed: false,
  files: entries
};
writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
  flag: "wx"
});
process.stdout.write(
  JSON.stringify({ directory, commit, files: entries.length, archive: manifest.archive }, null, 2) +
    "\n"
);
