"use strict";

// Packaging cross-check: every local require reachable from packaged
// .cjs/.mjs/.js files must be inside build.files (or a listed wildcard),
// otherwise the packaged app fails at the first require of that module —
// or later at the lazy require's call site. Dynamic requires built from
// variables are outside the scope of this static walk.
const fs = require("node:fs");
const path = require("node:path");

function buildPackageGraphReport({
  packageJsonPath = path.join(__dirname, "..", "package.json"),
  rootDirectory = path.resolve(__dirname, "..")
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const listed = new Set(pkg.build.files.filter((entry) => !/[[*?]/.test(entry)));
  const wildcards = pkg.build.files.filter((entry) => /[ [*?]/.test(entry));

  const seen = new Set();
  const queue = ["main.cjs"];
  const missing = [];
  let walked = 0;

  while (queue.length) {
    const relative = queue.pop();
    if (seen.has(relative)) continue;
    seen.add(relative);
    const absolute = path.join(rootDirectory, relative);
    if (!fs.existsSync(absolute)) {
      missing.push({ file: relative, why: "file not on disk" });
      continue;
    }
    walked++;
    const source = fs.readFileSync(absolute, "utf8");
    for (const match of source.matchAll(/require\("(\.[^"]+)"\)/g)) {
      const base = path.normalize(path.join(path.dirname(relative), match[1])).replace(/\\/g, "/");
      const candidates = [base, `${base}.cjs`, `${base}.js`, `${base}.mjs`];
      const found =
        candidates.find(
          (name) =>
            fs.existsSync(path.join(rootDirectory, name)) &&
            fs.statSync(path.join(rootDirectory, name)).isFile()
        ) || null;
      if (!found) continue;
      if (!listed.has(found)) {
        // Simple star patterns only ("dir/**/*" style prefixes/suffixes).
        const covered = wildcards.some((pattern) => {
          const [prefix = "", suffix = ""] = pattern.split("*");
          return found.startsWith(prefix.trim()) && found.endsWith(suffix.trim());
        });
        if (!covered) missing.push({ file: found, why: `required by ${relative}` });
      }
      if (/\.(cjs|mjs|js)$/.test(found)) queue.push(found);
    }
  }

  missing.sort((a, b) => a.file.localeCompare(b.file));
  return { walked, missing };
}

module.exports = { buildPackageGraphReport };

if (require.main === module) {
  const report = buildPackageGraphReport();
  console.log(`files walked: ${report.walked}; misses: ${report.missing.length}`);
  for (const { file, why } of report.missing) console.log(`MISS ${file} — ${why}`);
  if (report.missing.length) process.exitCode = 1;
}
