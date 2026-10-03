"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SIGNATURE_SCHEMA_VERSION = 1;
const CODE_SIGNING_EKU = "1.3.6.1.5.5.7.3.3";
const TIMESTAMPING_EKU = "1.3.6.1.5.5.7.3.8";

function normalizeThumbprint(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^a-f0-9]/gi, "").toUpperCase();
  return /^[A-F0-9]{40,128}$/.test(normalized) ? normalized : null;
}

function normalizeSubject(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeEkus(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()))]
    .filter(Boolean)
    .sort();
}

function validIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function validateCertificateWindow(notBefore, notAfter, label) {
  const from = validIso(notBefore);
  const to = validIso(notAfter);
  if (!from || !to || new Date(from) >= new Date(to)) {
    throw new Error(label + " certificate validity window is invalid.");
  }
  return { notBefore: from, notAfter: to };
}

function validateSignatureEvidence(evidence, expected) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Signature evidence must be an object.");
  }
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error("Expected signer pin must be an object.");
  }
  if (evidence.status !== "Valid") {
    throw new Error("Authenticode signature status is not Valid.");
  }

  const actualThumbprint = normalizeThumbprint(evidence.signerThumbprint);
  const expectedThumbprint = normalizeThumbprint(expected.thumbprint);
  if (!actualThumbprint || !expectedThumbprint || actualThumbprint !== expectedThumbprint) {
    throw new Error("Signer certificate thumbprint does not match the pinned value.");
  }

  const actualSubject = normalizeSubject(evidence.signerSubject);
  const expectedSubject = normalizeSubject(expected.subject);
  if (!actualSubject || !expectedSubject || actualSubject !== expectedSubject) {
    throw new Error("Signer certificate subject does not match the pinned value.");
  }

  const signerWindow = validateCertificateWindow(
    evidence.signerNotBefore,
    evidence.signerNotAfter,
    "Signer"
  );
  const signerEkus = normalizeEkus(evidence.signerEkus);
  if (!signerEkus.includes(CODE_SIGNING_EKU)) {
    throw new Error("Signer certificate does not include the Code Signing EKU.");
  }

  const timestampThumbprint = normalizeThumbprint(evidence.timestampThumbprint);
  const timestampSubject = normalizeSubject(evidence.timestampSubject);
  if (!timestampThumbprint || !timestampSubject) {
    throw new Error("Authenticode signature does not contain a timestamp certificate.");
  }
  const timestampWindow = validateCertificateWindow(
    evidence.timestampNotBefore,
    evidence.timestampNotAfter,
    "Timestamp"
  );
  const timestampEkus = normalizeEkus(evidence.timestampEkus);
  if (!timestampEkus.includes(TIMESTAMPING_EKU)) {
    throw new Error("Timestamp certificate does not include the Time Stamping EKU.");
  }

  const verifiedAt = validIso(evidence.verifiedAt);
  if (!verifiedAt) {
    throw new Error("Signature evidence contains an invalid verification time.");
  }

  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    authenticodeStatus: "Valid",
    signer: {
      subject: evidence.signerSubject.trim().replace(/\s+/g, " "),
      thumbprint: actualThumbprint,
      notBefore: signerWindow.notBefore,
      notAfter: signerWindow.notAfter,
      ekus: signerEkus
    },
    timestamp: {
      subject: evidence.timestampSubject.trim().replace(/\s+/g, " "),
      thumbprint: timestampThumbprint,
      notBefore: timestampWindow.notBefore,
      notAfter: timestampWindow.notAfter,
      ekus: timestampEkus
    },
    verifiedAt
  };
}

function installerIdentity(installerPath) {
  const stats = fs.statSync(installerPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Installer path is not a non-empty regular file.");
  }

  const digest = crypto.createHash("sha256");
  digest.update(fs.readFileSync(installerPath));

  return {
    filename: path.basename(installerPath),
    sizeBytes: stats.size,
    sha256: digest.digest("hex")
  };
}

function writeSignatureMetadata({
  evidencePath,
  installerPath,
  outputPath,
  expectedThumbprint,
  expectedSubject
}) {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const signature = validateSignatureEvidence(evidence, {
    thumbprint: expectedThumbprint,
    subject: expectedSubject
  });
  const metadata = {
    ...signature,
    artifact: installerIdentity(installerPath)
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  return metadata;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error("Unexpected argument: " + token);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --" + key);
    values[key] = value;
    index += 1;
  }
  return values;
}

function requireArg(values, key) {
  if (!values[key]) throw new Error("Missing required --" + key + " argument.");
  return values[key];
}

function runCli(argv) {
  const values = parseArgs(argv);
  const metadata = writeSignatureMetadata({
    evidencePath: requireArg(values, "evidence"),
    installerPath: requireArg(values, "installer"),
    outputPath: requireArg(values, "output"),
    expectedThumbprint: requireArg(values, "expected-thumbprint"),
    expectedSubject: requireArg(values, "expected-subject")
  });
  process.stdout.write(JSON.stringify(metadata, null, 2) + "\n");
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (cause) {
    process.stderr.write((cause instanceof Error ? cause.message : String(cause)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  CODE_SIGNING_EKU,
  SIGNATURE_SCHEMA_VERSION,
  TIMESTAMPING_EKU,
  installerIdentity,
  normalizeSubject,
  normalizeThumbprint,
  validateSignatureEvidence,
  writeSignatureMetadata
};
