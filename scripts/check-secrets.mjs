import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const textExtensions = new Set([
  ".cjs",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".html",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".txt",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);

const isDotenvFileName = (name) => name === ".env" || name.startsWith(".env.");

const patterns = [
  { name: "private key", value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "OpenAI-style key", value: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: "GitHub token", value: /\bgh[opsur]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained token", value: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "AWS access key", value: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }
];

// Scan tracked files (including force-added ignored files) and new source files.
// Private, ignored .env files are legitimate runtime inputs, not source artifacts.
const paths = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8"
  }
)
  .split("\0")
  .filter(Boolean);
const isSource = (path) => {
  const name = path.split(/[\\/]/u).at(-1) ?? "";
  return isDotenvFileName(name) || textExtensions.has(extname(path));
};
const files = [...new Set(paths)].filter(isSource);
const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  {
    cwd: root,
    encoding: "utf8"
  }
)
  .split("\0")
  .filter((path) => path && isSource(path));
const indexSource = (path) => {
  try {
    return execFileSync("git", ["show", `:${path}`], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    throw new Error("Secret scan could not read staged source.");
  }
};

const findings = [];
const scanSource = (relativeFile, source, suffix = "") => {
  for (const pattern of patterns) {
    if (pattern.value.test(source)) {
      findings.push(`${relativeFile}${suffix}: ${pattern.name}`);
    }
  }
  if (
    isDotenvFileName(relativeFile.split(/[\\/]/u).at(-1) ?? "") &&
    /^MODEL_API_KEY=(?!\s*$|your-|replace-|example)/m.test(source)
  ) {
    findings.push(`${relativeFile}${suffix}: configured model credential`);
  }
};
for (const path of files) {
  const file = join(root, path);
  scanSource(
    relative(root, file),
    existsSync(file) ? readFileSync(file, "utf8") : indexSource(path)
  );
}
for (const path of staged) scanSource(path, indexSource(path), " (staged)");

if (findings.length > 0) {
  process.stderr.write(`Potential secrets detected:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed.\n");
}
