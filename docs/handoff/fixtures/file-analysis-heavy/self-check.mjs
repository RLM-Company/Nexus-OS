#!/usr/bin/env node
/** Independent self-check for the heavy file-analysis fixture (offline, plain Node). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
let failures = 0;
const check = (ok, msg) => {
  if (!ok) {
    failures++;
    console.error("FAIL:", msg);
  }
};

function readZip(buffer) {
  const end = buffer.length - 22;
  check(buffer.readUInt32LE(end) === 0x06054b50, "ZIP end record");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    check(buffer.readUInt32LE(cursor) === 0x02014b50, "central directory");
    check(buffer.readUInt16LE(cursor + 10) === 0, "no compression");
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const local = buffer.readUInt32LE(cursor + 42);
    check(buffer.readUInt32LE(local) === 0x04034b50, "local header");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + size);
    check(bytes.length === size, `size ${name}`);
    check(crc32(bytes) === buffer.readUInt32LE(cursor + 16), `crc ${name}`);
    files.set(name, bytes);
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return files;
}

for (const line of readFileSync(join(here, "SHA256SUMS"), "utf8").split(/\r?\n/).filter(Boolean)) {
  const [hash, file] = line.split(/\s+/);
  check(sha(readFileSync(join(here, file))) === hash, `hash mismatch: ${file}`);
}

const outerBytes = readFileSync(join(here, "heavy.zip"));
const zip = readZip(outerBytes);
for (const member of manifest.archives.outer.members) {
  const bytes = zip.get(member.name);
  check(!!bytes, `missing member: ${member.name}`);
  if (!bytes) continue;
  check(bytes.length === member.bytes, `byte length: ${member.name}`);
  if (member.sha256) check(sha(bytes) === member.sha256, `sha256: ${member.name}`);
}
const longPdf = zip.get("long/report.pdf");
const scanPdf = zip.get("scans/scan.pdf");
check(longPdf?.subarray(0, 5).toString() === "%PDF-", "long PDF signature");
check(scanPdf?.subarray(0, 5).toString() === "%PDF-", "scan PDF signature");
check(
  (longPdf?.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length ===
    manifest.expected.long_pages,
  "long PDF page count"
);
const nestedZip = readZip(zip.get("nested-evidence.zip"));
check(nestedZip.has("nested/quote.txt"), "nested quote present");
check(
  nestedZip.get("nested/quote.txt")?.toString("utf8").includes("SELENE-047"),
  "nested quote content"
);
check(outerBytes.length <= manifest.limits.archive_bytes, "archive within export limit");
check(manifest.expected.csv_rows === 600, "CSV rows");

console.log(
  JSON.stringify(
    {
      self_check: failures ? "FAILED" : "passed",
      failures,
      zip_bytes: outerBytes.length,
      members: zip.size,
      pages: manifest.expected.long_pages
    },
    null,
    2
  )
);
process.exit(failures ? 1 : 0);
