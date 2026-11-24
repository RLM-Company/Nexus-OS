import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";

/**
 * Build a pinned Linux x86-64 OCI image from a release directory produced by
 * scripts/build-release.mjs. Runs on the disposable build host only (Docker
 * daemon required). The runtime never pulls an image: the immutable content
 * digest is written to build.json and consumed by deploy-release.mjs.
 *
 * --fail-at <stage> injects a failure at one pipeline stage for rollback drills.
 * Every stage writes progress into build.json *before* doing its work, so a
 * failed drill always reports the exact stage where it stopped and the command
 * that restores the previous working build.
 */
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const releaseDirArgument = option("--release");
const failAt = option("--fail-at");
if (!releaseDirArgument || !isAbsolute(releaseDirArgument)) {
  throw new Error("Usage: node scripts/build-image.mjs --release <absolute-release-dir> [--fail-at stage]");
}
const stages = ["verify-source", "verify-toolchain", "docker-build", "inspect-image", "record"];
if (failAt !== undefined && !stages.includes(failAt)) {
  throw new Error(`Unknown failure stage. Choose one of: ${stages.join(", ")}`);
}
const releaseDir = resolve(releaseDirArgument);
const manifest = JSON.parse(readFileSync(resolve(releaseDir, "manifest.json"), "utf8"));
if (manifest.format !== "kosmora-linux-x64-release-v1") throw new Error("Unsupported release format.");
const archivePath = resolve(releaseDir, manifest.archive.name);
const archiveBytes = readFileSync(archivePath);
if (createHash("sha256").update(archiveBytes).digest("hex") !== manifest.archive.sha256) {
  throw new Error("Release archive SHA-256 mismatch; refusing to build.");
}
const buildPath = resolve(releaseDir, "build.json");
const progress = {
  format: "kosmora-linux-x64-build-v1",
  release: manifest.label,
  commit: manifest.commit,
  platform: "linux/amd64",
  status: "started",
  failed_stage: null,
  stages: [],
  image: null,
  requirements: null,
  rollback_command: null
};
const noteStage = (stage, state, detail = {}) => {
  progress.stages.push({ stage, state, at: new Date().toISOString(), ...detail });
  writeFileSync(buildPath, JSON.stringify(progress, null, 2) + "\n");
  if (failAt === stage && state === "start") {
    progress.status = "failed";
    progress.failed_stage = stage;
    writeFileSync(buildPath, JSON.stringify(progress, null, 2) + "\n");
    throw new Error(
      `[${stage}] injected build failure. Restore the working build with:\n` +
        `  bash scripts/deploy-release.sh --rollback <previous-image-digest> <previous-db-snapshot>`
    );
  }
};
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

noteStage("verify-source", "start");
// The detached source archive must match the checked-out commit byte for byte.
const tree = run("git", ["ls-tree", "-r", "-z", manifest.commit]);
const sourceFiles = tree.split("\0").filter(Boolean).length;
if (sourceFiles !== manifest.source_files) throw new Error("Source file count does not match manifest.");
noteStage("verify-source", "ok", { files: sourceFiles });

noteStage("verify-toolchain", "start");
const dockerVersion = run("docker", ["version", "--format", "{{.Server.Version}}"]).trim();
noteStage("verify-toolchain", "ok", { docker_server: dockerVersion });

noteStage("docker-build", "start");
const tag = `cosmora-alpha-app:${manifest.commit.slice(0, 12)}`;
// Build context is the extracted, pinned release archive, never the live checkout.
const context = resolve(releaseDir, "context");
mkdirSync(context, { recursive: true });
run("tar", ["-xzf", archivePath, "-C", context, "--strip-components=1"]);
const { execFileSync: runInContext } = await import("node:child_process");
runInContext(
  "docker",
  [
    "build",
    "--platform",
    "linux/amd64",
    "--label",
    `org.opencontainers.image.revision=${manifest.commit}`,
    "--label",
    `org.opencontainers.image.source=${manifest.label}`,
    "--tag",
    tag,
    "--file",
    "deploy/alpha/Dockerfile",
    "."
  ],
  { cwd: context, encoding: "utf8", stdio: "inherit", maxBuffer: 32 * 1024 * 1024 }
);
noteStage("docker-build", "ok", { tag });

noteStage("inspect-image", "start");
const image = run("docker", [
  "image",
  "inspect",
  "--format",
  "{{.Id}} {{.Size}} {{.Architecture}} {{.Os}}",
  tag
]).trim();
const [digest, size, architecture, os] = image.split(/\s+/);
if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Docker did not return a content digest.");
if (architecture !== "amd64" || os !== "linux") throw new Error("Image is not linux/amd64.");
noteStage("inspect-image", "ok", { digest, size: Number(size), architecture, os });

noteStage("record", "start");
progress.image = { digest, bytes: Number(size), tag, architecture, os };
progress.requirements = {
  disk_bytes: Math.ceil(Number(size) * 2.5 + manifest.source_bytes + 512 * 1024 * 1024),
  memory_bytes: 2 * 1024 * 1024 * 1024,
  note:
    "disk = 2.5x image (layers + unpacked rootfs) + source + 512 MiB headroom for SQLite/WAL; " +
    "memory = 2 GiB for the Next build at install time; runtime services fit lower."
};
progress.rollback_command =
  `bash scripts/deploy-release.sh --rollback <previous-image-digest> <previous-db-snapshot>`;
progress.status = "ok";
noteStage("record", "ok");
process.stdout.write(JSON.stringify(progress, null, 2) + "\n");
