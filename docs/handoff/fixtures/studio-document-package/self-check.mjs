#!/usr/bin/env node
/**
 * Self-check for the Studio document package A.
 * Pure Node, no dependencies. Fails with a non-zero exit code on any mismatch.
 * Usage: node self-check.mjs [--dir <dir>]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(
  process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : here
);
const read = (name) => readFileSync(join(dir, name));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
const json = (name) => JSON.parse(read(name).toString("utf8"));

/* --------------------------------------------------------- ZIP reader ----- */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => view.getUint16(o, true);
  const u32 = (o) => view.getUint32(o, true);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("ZIP central directory not found");
  const count = u16(end + 10);
  const members = new Map();
  let p = u32(end + 16);
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) throw new Error("Bad ZIP central header");
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const name = bytes.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const method = u16(p + 10);
    const local = u32(p + 42);
    if (method !== 0) throw new Error("Only stored ZIP entries are expected");
    const localNameLen = u16(local + 26);
    const localExtraLen = u16(local + 28);
    const start = local + 30 + localNameLen + localExtraLen;
    const size = u32(p + 24);
    members.set(name, bytes.subarray(start, start + size));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

/* ---------------------------------------------------------------- checks --- */
const manifest = json("manifest.json");
check(manifest.format === "kosmora.studio-document-package.v1", "Unexpected manifest format");
check(manifest.deterministic === true, "Manifest must declare deterministic generation");

const sums = read("SHA256SUMS")
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [hash, name] = line.trim().split(/\s+/);
    return { hash, name };
  });
check(sums.length >= 4, "SHA256SUMS must cover at least 4 files");
for (const { hash, name } of sums) {
  check(sha256(read(name)) === hash, `SHA256SUMS mismatch: ${name}`);
}

for (const key of ["simple", "extended"]) {
  const desc = manifest.archives[key];
  const bytes = read(desc.file);
  check(bytes.length === desc.bytes, `${key}: byte length mismatch`);
  check(sha256(bytes) === desc.sha256, `${key}: archive hash mismatch`);
  const members = readZip(bytes);
  check(members.size === desc.members.length, `${key}: member count mismatch`);
  for (const m of desc.members) {
    const data = members.get(m.name);
    check(!!data, `${key}: missing member ${m.name}`);
    if (!data) continue;
    check(data.length === m.bytes, `${key}: ${m.name} size mismatch`);
    check(sha256(data) === m.sha256, `${key}: ${m.name} hash mismatch`);
    if (m.name.endsWith(".pdf")) {
      check(data.subarray(0, 5).toString() === "%PDF-", `${key}: ${m.name} is not a PDF`);
    }
    if (m.name.endsWith(".docx")) {
      check(data.subarray(0, 2).toString() === "PK", `${key}: ${m.name} is not a DOCX ZIP`);
      const docxMembers = readZip(data);
      check(docxMembers.has("word/document.xml"), `${key}: ${m.name} lacks word/document.xml`);
      const xml = docxMembers.get("word/document.xml")?.toString("utf8") ?? "";
      check(xml.includes("schemas.openxmlformats.org"), `${key}: ${m.name} has no Word namespace`);
      for (const c of manifest.citations.filter((c) => c.file === m.name))
        check(
          xml.includes(c.quote.replaceAll("&", "&amp;")),
          `${key}: quote missing in ${m.name}: ${c.quote}`
        );
    }
  }
  const expectedNames = [...members.keys()]
    .filter(
      (name) =>
        (manifest.coverage_rules.supported_extensions.some((ext) =>
          name.toLowerCase().endsWith(`.${ext}`)
        ) ||
          name === "nested.zip") &&
        !name.startsWith("__MACOSX/")
    )
    .flatMap((name) =>
      name === "nested.zip"
        ? ["nested.zip › nested › brief.txt", "nested.zip › nested › extra.csv"]
        : [name.replaceAll("/", " › ")]
    );
  check(
    JSON.stringify(expectedNames.sort()) ===
      JSON.stringify([...desc.expected_document_names].sort()),
    `${key}: expected_document_names mismatch`
  );
  for (const skip of desc.skipped ?? [])
    check(members.has(skip.name), `${key}: skipped member missing ${skip.name}`);
  for (const inc of desc.incomplete ?? [])
    check(members.has(inc.name), `${key}: incomplete member missing ${inc.name}`);
  for (const nested of desc.nested_expanded ?? [])
    check(members.has(nested.name), `${key}: nested archive member missing ${nested.name}`);
}

// Text citations must appear verbatim in extracted TXT/CSV members.
for (const key of ["simple", "extended"]) {
  const members = readZip(read(manifest.archives[key].file));
  for (const c of manifest.citations.filter((c) => /\.(txt|csv)$/.test(c.file))) {
    const text = members.get(c.file)?.toString("utf8") ?? "";
    check(text.includes(c.quote), `${key}: quote missing in ${c.file}: ${c.quote}`);
  }
}

// Page counts: PDF objects must match the manifest page declarations.
for (const p of manifest.pages) {
  const bytes = readZip(read(manifest.archives.extended.file)).get(p.file);
  if (!bytes) {
    check(false, `page source missing: ${p.file}`);
    continue;
  }
  const count = (bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  check(count === p.total_pages, `${p.file}: expected ${p.total_pages} pages, found ${count}`);
}

if (failures.length) {
  console.error(`SELF-CHECK FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      self_check: "passed",
      archives: Object.keys(manifest.archives),
      members_simple: manifest.archives.simple.members.length,
      members_extended: manifest.archives.extended.members.length,
      citations: manifest.citations.length,
      pages: manifest.pages.length,
      skipped: manifest.archives.extended.skipped.length,
      incomplete: manifest.archives.extended.incomplete.length,
      duplicates: manifest.archives.extended.nested_expanded.length
    },
    null,
    2
  )
);
