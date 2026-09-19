import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "repo-files"
]);
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

const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    if (isDotenvFileName(entry.name) || textExtensions.has(extname(entry.name))) return [path];
    return [];
  });

const findings = [];
for (const file of files(root)) {
  const source = readFileSync(file, "utf8");
  const relativeFile = relative(root, file);
  for (const pattern of patterns) {
    if (pattern.value.test(source)) {
      findings.push(`${relativeFile}: ${pattern.name}`);
    }
  }
  if (
    isDotenvFileName(relativeFile.split(/[\\/]/u).at(-1) ?? "") &&
    /^MODEL_API_KEY=(?!\s*$|your-|replace-|example)/m.test(source)
  ) {
    findings.push(`${relativeFile}: configured model credential`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Potential secrets detected:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed.\n");
}
