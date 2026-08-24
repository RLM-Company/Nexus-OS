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
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);

const patterns = [
  { name: "private key", value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "OpenAI-style key", value: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: "GitHub token", value: /\bgh[opsu]_[A-Za-z0-9]{30,}\b/ },
  { name: "AWS access key", value: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }
];

const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    if (entry.name === ".env.example" || textExtensions.has(extname(entry.name))) return [path];
    return [];
  });

const findings = [];
for (const file of files(root)) {
  const source = readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.value.test(source)) {
      findings.push(`${relative(root, file)}: ${pattern.name}`);
    }
  }
  if (file.endsWith(".env") && /^MODEL_API_KEY=(?!\s*$|your-|replace-|example)/m.test(source)) {
    findings.push(`${relative(root, file)}: configured model credential`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Potential secrets detected:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed.\n");
}
