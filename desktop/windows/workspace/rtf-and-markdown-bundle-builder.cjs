"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Escapes arbitrary Unicode strings (including Cyrillic and Emoji) into Rich Text Format 1.9.1
 * `\uN?` signed 16-bit escape sequences so WordPad, MS Word, and LibreOffice render them natively.
 */
function encodeRtfUnicode(text) {
  const str = String(text ?? "");
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x5c || code === 0x7b || code === 0x7d) {
      out += "\\" + str[i];
    } else if (code === 0x0a) {
      out += "\\line ";
    } else if (code >= 0x20 && code <= 0x7e) {
      out += str[i];
    } else {
      // RTF \uN? uses signed 16-bit integer
      const signed16 = code > 32767 ? code - 65536 : code;
      out += `\\u${signed16}?`;
    }
  }
  return out;
}

/**
 * Compiles a structured report into 3 universal desktop formats simultaneously:
 * 1. Rich Text Format 1.9.1 (`.rtf`) with Unicode Cyrillic support
 * 2. GitHub-Flavored Markdown (`.md`)
 * 3. Clean Plain Text (`.txt`)
 */
function buildTriFormatDocumentStrings(spec = {}) {
  const title = spec.title || "Koswork Autonomous Report";
  const sections = Array.isArray(spec.sections) ? spec.sections : [];

  // 1. Build RTF 1.9.1
  const rtfBlocks = [
    "{\\rtf1\\ansi\\ansicpg1251\\deff0\\nouicompat{\\fonttbl{\\f0\\fnil\\fcharset204 Segoe UI;}}",
    "{\\colortbl ;\\red15\\green23\\blue42;\\red37\\green99\\blue235;}",
    "\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\cf1\\b\\f0\\fs32 " +
      encodeRtfUnicode(title) +
      "\\b0\\fs22\\par"
  ];

  // 2. Build Markdown & Plain Text
  const mdLines = [`# ${title}`, ""];
  const txtLines = [title.toUpperCase(), "=".repeat(Math.min(72, title.length)), ""];

  for (const sec of sections) {
    const heading = sec.heading || "Section";
    const paragraphs = Array.isArray(sec.paragraphs) ? sec.paragraphs : [sec.body || ""];

    rtfBlocks.push("\\pard\\sa160\\cf2\\b\\fs26 " + encodeRtfUnicode(heading) + "\\b0\\cf1\\fs22\\par");
    mdLines.push(`## ${heading}`, "");
    txtLines.push(heading, "-".repeat(Math.min(60, heading.length)));

    for (const p of paragraphs.filter(Boolean)) {
      rtfBlocks.push("\\pard\\sa160\\sl276\\slmult1 " + encodeRtfUnicode(p) + "\\par");
      mdLines.push(p, "");
      txtLines.push(p, "");
    }
  }

  rtfBlocks.push("}");

  return {
    rtf: rtfBlocks.join("\n"),
    markdown: mdLines.join("\n"),
    plainText: txtLines.join("\n")
  };
}

function saveTriFormatBundleToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "report")
    .replace(/\.(rtf|md|txt)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const rtfPath = path.resolve(resolvedWorkspace, `${cleanBase}.rtf`);
  const mdPath = path.resolve(resolvedWorkspace, `${cleanBase}.md`);
  const txtPath = path.resolve(resolvedWorkspace, `${cleanBase}.txt`);

  if (!rtfPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildTriFormatDocumentStrings(spec);
  fs.writeFileSync(rtfPath, built.rtf, "utf8");
  fs.writeFileSync(mdPath, built.markdown, "utf8");
  fs.writeFileSync(txtPath, built.plainText, "utf8");

  return {
    rtfPath,
    mdPath,
    txtPath,
    rtfBytes: Buffer.byteLength(built.rtf, "utf8"),
    sha256: crypto.createHash("sha256").update(built.rtf, "utf8").digest("hex")
  };
}

module.exports = {
  encodeRtfUnicode,
  buildTriFormatDocumentStrings,
  saveTriFormatBundleToWorkspace
};
