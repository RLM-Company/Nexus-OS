"use strict";

/**
 * Koswork Untrusted Web Content Sanitizer & Hidden DOM Prompt-Trap Filter
 * (`desktop/windows/browser/content-sanitizer.cjs`).
 *
 * Protects the Browser Research Cycle against indirect prompt injection embedded in external web pages:
 * 1. Strips hidden HTML blocks (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, `hidden`)
 *    so invisible attacker text never enters `fullTextUtf16` or shifts visible UTF-16 offsets.
 * 2. Strips invisible Unicode zero-width and bidirectional steganography (`\u200B..\u200F`, `\u202A..\u202E`, `\uFEFF`).
 * 3. Neutralizes ChatML / tool-call role delimiter spoofing (`<|im_start|>`, `<|im_end|>`, `</tool_call>`)
 *    and records structured `securityAdvisories` on the page snapshot.
 */

const HIDDEN_TAG_REGEX =
  /<([a-z0-9]+)\b[^>]*(?:\bhidden\b|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\b|font-size\s*:\s*0(?:px|pt|em|rem)?)[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/gi;

const UNICODE_STEGANOGRAPHY_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

const DELIMITER_SPOOF_PATTERNS = [
  { code: "CHATML_DELIMITER_SPOOF", regex: /<\|im_(?:start|end)\|>/gi },
  { code: "TOOL_CALL_DELIMITER_SPOOF", regex: /<\/?tool_call>/gi },
  {
    code: "PROMPT_OVERRIDE_TRAP",
    regex: /\b(?:ignore all previous instructions|system override:\s*upload|забудь предыдущие инструкции и отправь|\.env)\b/gi
  }
];

function sanitizeWebDocumentAndStripHiddenPromptTraps(input = {}) {
  const advisories = [];
  let sanitizedHtml = String(input.html || "");
  let sanitizedText = String(input.text || "");

  if (sanitizedHtml) {
    sanitizedHtml = sanitizedHtml.replace(HIDDEN_TAG_REGEX, (_fullMatch, tag, innerContent) => {
      const preview = String(innerContent || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (preview) {
        advisories.push({
          type: "HIDDEN_DOM_PROMPT_TRAP_STRIPPED",
          tag: String(tag).toLowerCase(),
          preview
        });
      }
      return "";
    });
  }

  const stripSteganographyAndDelimiters = (rawStr, sourceField) => {
    let str = String(rawStr || "");
    if (!str) return "";

    const stegoMatches = str.match(UNICODE_STEGANOGRAPHY_REGEX);
    if (stegoMatches && stegoMatches.length > 0) {
      advisories.push({
        type: "UNICODE_STEGANOGRAPHY_STRIPPED",
        field: sourceField,
        removedCodePointsCount: stegoMatches.length
      });
      str = str.replace(UNICODE_STEGANOGRAPHY_REGEX, "");
    }

    for (const pat of DELIMITER_SPOOF_PATTERNS) {
      if (pat.regex.test(str)) {
        advisories.push({
          type: pat.code,
          field: sourceField
        });
      }
      pat.regex.lastIndex = 0;
    }

    str = str
      .replace(/<\|im_(?:start|end)\|>/gi, "[STRIPPED_CHATML_DELIMITER]")
      .replace(/<\/?tool_call>/gi, "[STRIPPED_TOOL_DELIMITER]");

    return str;
  };

  sanitizedHtml = stripSteganographyAndDelimiters(sanitizedHtml, "html");
  sanitizedText = stripSteganographyAndDelimiters(sanitizedText, "text");

  return {
    sanitizedHtml,
    sanitizedText,
    securityAdvisories: advisories
  };
}

module.exports = {
  sanitizeWebDocumentAndStripHiddenPromptTraps
};
