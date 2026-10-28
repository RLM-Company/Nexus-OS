/** Protect byte-sensitive spans before sending natural language to a translator. */
export class RelayProtectionError extends Error {
  readonly code = "RELAY_PROTECTION_DENIED";
}

const sensitive =
  /(?:\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|Bearer\s+\S+|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret[_-]?key\s*[:=]\s*\S+|access[_-]?token\s*[:=]\s*\S+)\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

const protectedSpans = new RegExp(
  [
    /```[\s\S]*?```/.source,
    /`[^`\r\n]+`/.source,
    /https?:\/\/[^\s<>"')]+/.source,
    /\bsha256:[a-f0-9]{64}\b/i.source,
    /\b[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/i.source,
    /(?:[A-Za-z]:\\|\.\.?\/)[\w.\\/-]+/.source,
    /(?:^|(?<=\s))\/(?:api|etc|var|usr|opt|home|tmp|workspace|app|src|packages|docs|scripts|deploy|desktop)\/[\w./-]+/
      .source,
    /\b(?:[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|jsx|cjs|mjs|json|py|md|sql|sh|env|yaml|yml|toml|ini|conf|lock|css|scss|html|xml|csv|tsv|ps1))\b/
      .source,
    /\b[A-Z][A-Z0-9_]{2,}=\S+/.source,
    /^\s*(?:\$\s+|git\s+|npm\s+|pnpm\s+|node\s+|python3?\s+|docker\s+|podman\s+|curl\s+|sudo\s+|pytest\s+|vitest\s+|kubectl\s+|systemctl\s+).+$/
      .source
  ].join("|"),
  "gimy"
);

// Parse balanced inline JSON instead of treating nested objects as a flat regex.
const jsonEnd = (input: string, start: number): number | null => {
  const stack: string[] = [];
  let quoted = false,
    escaped = false;
  for (let index = start; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return null;
      if (!stack.length) {
        try {
          JSON.parse(input.slice(start, index + 1));
          return index + 1;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

const replaceProtected = (input: string, replace: (span: string) => string): string => {
  let result = "";
  for (let index = 0; index < input.length;) {
    protectedSpans.lastIndex = index;
    const token = protectedSpans.exec(input)?.[0];
    const end =
      !token && (input[index] === "{" || input[index] === "[") ? jsonEnd(input, index) : null;
    if (token || end !== null) {
      const span = token ?? input.slice(index, end!);
      result += replace(span);
      index += span.length;
    } else result += input[index++]!;
  }
  return result;
};

const fullJson = (text: string): boolean => {
  if (!/^\s*[[{]/.test(text)) return false;
  try {
    return typeof JSON.parse(text) === "object";
  } catch {
    return false;
  }
};

export interface RelayAttachmentCandidate {
  name?: string;
  mime_type?: string;
  content: string;
}

const NON_TRANSLATABLE_EXTENSIONS =
  /\.(?:ts|tsx|js|jsx|cjs|mjs|json|py|sql|sh|env|yaml|yml|toml|ini|conf|lock|css|scss|html|xml|csv|tsv|ps1|bat|cmd|wasm|bin|exe|dll|so|dylib|zip|tar|gz|pdf|docx|xlsx|pptx|png|jpe?g|webp|gif|mp3|wav|ogg)$/i;

/**
 * Checks whether an attachment is eligible for opt-in natural-language relay translation.
 * Binary files, structured JSON, CSV/TSV tables with identifiers, and code files are never translated.
 */
export function inspectRelayAttachment(attachment: RelayAttachmentCandidate): {
  translatable: boolean;
  reason?: string;
} {
  const content = attachment.content ?? "";
  if (!content.trim() || content.length > 4000) {
    return { translatable: false, reason: "Attachment is empty or exceeds safe relay size" };
  }
  if (content.includes("\0")) {
    return { translatable: false, reason: "Binary attachment data cannot be translated" };
  }
  if (attachment.name && NON_TRANSLATABLE_EXTENSIONS.test(attachment.name.trim())) {
    return {
      translatable: false,
      reason: "Code, config, tabular, and binary file types are not translated"
    };
  }
  const mime = (attachment.mime_type ?? "").toLowerCase().split(";")[0]!.trim();
  if (mime && mime !== "text/plain" && mime !== "text/markdown") {
    return {
      translatable: false,
      reason: `Attachment MIME type ${mime} is not eligible for natural-language relay`
    };
  }
  if (sensitive.test(content)) {
    return { translatable: false, reason: "Attachment contains potential secrets" };
  }
  if (fullJson(content)) {
    return { translatable: false, reason: "Structured JSON attachments are not translated" };
  }
  // Reject tabular CSV/TSV content with identifiers (multiple lines sharing consistent tab/semicolon/comma columns)
  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length >= 2) {
    const tabCounts = lines.map((line) => line.split("\t").length);
    const commaCounts = lines.map((line) => line.split(",").length);
    const semicolonCounts = lines.map((line) => line.split(";").length);
    if (
      (tabCounts[0]! >= 2 && tabCounts.every((c) => c === tabCounts[0])) ||
      (commaCounts[0]! >= 2 && commaCounts.every((c) => c === commaCounts[0])) ||
      (semicolonCounts[0]! >= 2 && semicolonCounts.every((c) => c === semicolonCounts[0]))
    ) {
      return {
        translatable: false,
        reason: "Tabular data with identifiers is not translated automatically"
      };
    }
  }
  return { translatable: true };
}

/**
 * ASCII-language heuristic for explicit callers; not proof that text is English.
 * No production route automatically skips translation based on this heuristic.
 */
export function isAlreadyEnglishRelayText(input: string): boolean {
  if (!input.trim()) return false;
  const stripped = replaceProtected(input, () => " ").trim();
  if (!stripped) return true;
  if (
    [...stripped].some((char) => {
      const code = char.codePointAt(0)!;
      return code > 0x7f && (code < 0x2000 || code > 0x206f);
    })
  )
    return false;
  return /[A-Za-z]{2,}/.test(stripped);
}

export function protectRelayText(input: string): {
  text: string;
  fragments: readonly string[];
  alreadyEnglish: boolean;
  restore: (result: string) => string;
} {
  if (input.length > 4000 || !input.trim())
    throw new RelayProtectionError("Text is empty or exceeds the safe relay limit");
  if (/KM_PROTECTED_\d+_END/.test(input))
    throw new RelayProtectionError("Ambiguous or already-protected relay token in input");
  if (sensitive.test(input))
    throw new RelayProtectionError("Possible secrets: relay is disabled for this request");
  if (fullJson(input)) throw new RelayProtectionError("Structured JSON is not translated");
  const fragments: string[] = [];
  const text = replaceProtected(input, (span) => {
    const key = `KM_PROTECTED_${String(fragments.length).padStart(4, "0")}_END`;
    if (input.includes(key)) throw new RelayProtectionError("Ambiguous protected token");
    fragments.push(span);
    return key;
  });
  return {
    text,
    fragments: Object.freeze([...fragments]),
    alreadyEnglish: isAlreadyEnglishRelayText(input),
    restore: (result: string) => {
      if (result.length > 12000) throw new RelayProtectionError("Translation exceeded safe size");
      for (let i = 0; i < fragments.length; i++) {
        const marker = `KM_PROTECTED_${String(i).padStart(4, "0")}_END`;
        if (result.split(marker).length !== 2)
          throw new RelayProtectionError("Protected content was modified by translation");
        result = result.replace(marker, () => fragments[i]!);
      }
      if (/KM_PROTECTED_\d+_END/.test(result))
        throw new RelayProtectionError("Translation added unknown protected spans");
      return result;
    }
  };
}
