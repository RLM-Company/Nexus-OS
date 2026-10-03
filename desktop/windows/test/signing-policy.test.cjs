"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CODE_SIGNING_EKU,
  TIMESTAMPING_EKU,
  installerIdentity,
  normalizeThumbprint,
  validateSignatureEvidence,
  writeSignatureMetadata
} = require("../signing-policy.cjs");

function evidence(overrides = {}) {
  return {
    status: "Valid",
    signerSubject: "CN=Cosmora Software, O=RLM-Company",
    signerThumbprint: "AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD",
    signerNotBefore: "2026-01-01T00:00:00Z",
    signerNotAfter: "2027-01-01T00:00:00Z",
    signerEkus: [CODE_SIGNING_EKU],
    timestampSubject: "CN=Trusted Timestamp CA",
    timestampThumbprint: "11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF 00 11 22 33 44",
    timestampNotBefore: "2025-01-01T00:00:00Z",
    timestampNotAfter: "2030-01-01T00:00:00Z",
    timestampEkus: [TIMESTAMPING_EKU],
    verifiedAt: "2026-10-03T09:30:00Z",
    ...overrides
  };
}

const expected = {
  thumbprint: "AABBCCDDEEFF00112233445566778899AABBCCDD",
  subject: "cn=cosmora software, o=rlm-company"
};

test("normalizes certificate thumbprints", () => {
  assert.equal(
    normalizeThumbprint("aa bb-cc:dd ee ff 00 11 22 33 44 55 66 77 88 99 aa bb cc dd"),
    expected.thumbprint
  );
  assert.equal(normalizeThumbprint("not-a-thumbprint"), null);
  assert.equal(normalizeThumbprint("A".repeat(41)), null);
});

test("accepts pinned signer with code signing EKU and timestamp", () => {
  const metadata = validateSignatureEvidence(evidence(), expected);

  assert.equal(metadata.authenticodeStatus, "Valid");
  assert.equal(metadata.signer.thumbprint, expected.thumbprint);
  assert.equal(metadata.signer.ekus.includes(CODE_SIGNING_EKU), true);
  assert.equal(metadata.timestamp.ekus.includes(TIMESTAMPING_EKU), true);
  assert.equal(metadata.verifiedAt, "2026-10-03T09:30:00.000Z");
});

test("rejects an unexpected signer thumbprint or subject", () => {
  assert.throws(
    () => validateSignatureEvidence(evidence({ signerThumbprint: "F".repeat(40) }), expected),
    /thumbprint/
  );
  assert.throws(
    () => validateSignatureEvidence(evidence({ signerSubject: "CN=Other Publisher" }), expected),
    /subject/
  );
});

test("rejects certificates missing required EKUs", () => {
  assert.throws(
    () => validateSignatureEvidence(evidence({ signerEkus: [] }), expected),
    /Code Signing EKU/
  );
  assert.throws(
    () => validateSignatureEvidence(evidence({ timestampEkus: [] }), expected),
    /Time Stamping EKU/
  );
});

test("rejects missing timestamp evidence and non-valid Authenticode status", () => {
  assert.throws(
    () =>
      validateSignatureEvidence(
        evidence({ timestampSubject: "", timestampThumbprint: "" }),
        expected
      ),
    /timestamp certificate/
  );
  assert.throws(
    () => validateSignatureEvidence(evidence({ status: "UnknownError" }), expected),
    /not Valid/
  );
});

test("writes sanitized signature metadata without the expected pin inputs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cosmora-signature-"));
  const evidencePath = path.join(directory, "evidence.json");
  const installerPath = path.join(directory, "Cosmora-Setup-0.6.0-x64.exe");
  const outputPath = path.join(directory, "signature-metadata.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence()), "utf8");
  fs.writeFileSync(installerPath, "signed-installer-fixture", "utf8");

  const identity = installerIdentity(installerPath);
  const metadata = writeSignatureMetadata({
    evidencePath,
    installerPath,
    outputPath,
    expectedThumbprint: expected.thumbprint,
    expectedSubject: expected.subject
  });
  const disk = fs.readFileSync(outputPath, "utf8");

  assert.equal(JSON.parse(disk).signer.thumbprint, expected.thumbprint);
  assert.equal(metadata.signer.subject, "CN=Cosmora Software, O=RLM-Company");
  assert.equal(metadata.artifact.filename, "Cosmora-Setup-0.6.0-x64.exe");
  assert.equal(metadata.artifact.sha256, identity.sha256);
  assert.equal(metadata.artifact.sizeBytes, identity.sizeBytes);
  assert.equal(disk.includes("expectedThumbprint"), false);
  assert.equal(disk.includes("expectedSubject"), false);
});
