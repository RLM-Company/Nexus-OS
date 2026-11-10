"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function escapeIcsText(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function formatUtcIcsTimestamp(isoStr) {
  const d = new Date(isoStr || Date.now());
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Zero-dependency RFC 5545 iCalendar (.ics) & RFC 6350 vCard 4.0 (.vcf)
 * Personal Information Management (PIM) Bundle Builder for Koswork Desktop Workspace.
 */
function buildIcalAndVcardStrings(spec = {}) {
  const events = Array.isArray(spec.events) ? spec.events : [];
  const contacts = Array.isArray(spec.contacts) ? spec.contacts : [];

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kosmora Autonomous OS//Koswork PIM//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const uid = ev.uid || `koswork-evt-${i + 1}@kosmora.local`;
    icsLines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatUtcIcsTimestamp(ev.startIso)}`,
      `DTSTART:${formatUtcIcsTimestamp(ev.startIso)}`,
      `DTEND:${formatUtcIcsTimestamp(ev.endIso)}`,
      `SUMMARY:${escapeIcsText(ev.summary || "Scheduled Task")}`,
      ev.description ? `DESCRIPTION:${escapeIcsText(ev.description)}` : "",
      ev.location ? `LOCATION:${escapeIcsText(ev.location)}` : "",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  icsLines.push("END:VCALENDAR");

  const vcfBlocks = contacts.map((c) => {
    const fn = escapeIcsText(c.fullName || "Kosmora Contact");
    const org = c.organization ? `ORG:${escapeIcsText(c.organization)}` : "";
    const email = c.email ? `EMAIL;TYPE=work:${c.email}` : "";
    const tel = c.phone ? `TEL;TYPE=cell:${c.phone}` : "";
    return [
      "BEGIN:VCARD",
      "VERSION:4.0",
      `FN:${fn}`,
      org,
      email,
      tel,
      "END:VCARD"
    ]
      .filter(Boolean)
      .join("\r\n");
  });

  return {
    ics: icsLines.filter(Boolean).join("\r\n") + "\r\n",
    vcf: vcfBlocks.join("\r\n") + "\r\n"
  };
}

function saveIcalAndVcardToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "schedule-contacts")
    .replace(/\.(ics|vcf)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const icsPath = path.resolve(resolvedWorkspace, `${cleanBase}.ics`);
  const vcfPath = path.resolve(resolvedWorkspace, `${cleanBase}.vcf`);

  if (!icsPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildIcalAndVcardStrings(spec);
  fs.writeFileSync(icsPath, built.ics, "utf8");
  fs.writeFileSync(vcfPath, built.vcf, "utf8");

  return {
    icsPath,
    vcfPath,
    sha256: crypto.createHash("sha256").update(built.ics + built.vcf, "utf8").digest("hex")
  };
}

module.exports = {
  buildIcalAndVcardStrings,
  saveIcalAndVcardToWorkspace
};
