"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectZipArchiveSafety,
  buildSyntheticZipCentralDirBuffer
} = require("../ci/archive-quarantine-verifier.cjs");

test("inspectZipArchiveSafety passes clean archives and quarantines Zip-Slip, Zip-Bombs, Symlinks, and Executables", () => {
  // 1. Clean archive
  const cleanZip = buildSyntheticZipCentralDirBuffer([
    { fileName: "docs/architecture.md", compressedSize: 100, uncompressedSize: 250 },
    { fileName: "data/metrics.json", compressedSize: 80, uncompressedSize: 160 }
  ]);
  const cleanReport = inspectZipArchiveSafety(cleanZip);
  assert.equal(cleanReport.safe, true);
  assert.equal(cleanReport.violations.length, 0);
  assert.equal(cleanReport.totalEntries, 2);

  // 2. Malicious archive with Zip-Slip, Symlink, 500:1 Zip-Bomb, and .exe payload
  const maliciousZip = buildSyntheticZipCentralDirBuffer([
    { fileName: "../../Windows/System32/cmd.exe", compressedSize: 50, uncompressedSize: 100 },
    { fileName: "link_to_etc_passwd", compressedSize: 32, uncompressedSize: 32, isSymlink: true },
    { fileName: "bomb.txt", compressedSize: 20, uncompressedSize: 20000 } // 1000:1 ratio
  ]);

  const badReport = inspectZipArchiveSafety(maliciousZip, { maxCompressionRatio: 100 });
  assert.equal(badReport.safe, false);
  assert.ok(badReport.violations.some((v) => v.includes("ZIP_SLIP_PATH_TRAVERSAL")));
  assert.ok(badReport.violations.some((v) => v.includes("DANGEROUS_EXECUTABLE_ENTRY")));
  assert.ok(badReport.violations.some((v) => v.includes("SYMLINK_ENTRY_BLOCKED")));
  assert.ok(badReport.violations.some((v) => v.includes("ZIP_BOMB_RATIO_EXCEEDED")));
});
