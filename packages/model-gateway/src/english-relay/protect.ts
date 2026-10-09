/** Protect byte-sensitive spans before sending natural language to a translator. */
export class RelayProtectionError extends Error {}
const sensitive =
  /(?:\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+\S+|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+)\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
const protectedSpans =
  /```[\s\S]*?```|`[^`\r\n]+`|https?:\/\/[^\s<>"']+|(?:[A-Za-z]:\\|\.\.?\/)[\w.\\/-]+|\b(?:[\w.-]+\/[\w./-]+\.(?:ts|tsx|js|json|py|md|sql|sh|env))\b|^\s*(?:\$\s+|git\s+|npm\s+|pnpm\s+|curl\s+|sudo\s+).+$/gm;
const fullJson = (text: string): boolean => {
  if (!/^\s*[[{]/.test(text)) return false;
  try {
    return typeof JSON.parse(text) === "object";
  } catch {
    return false;
  }
};
export function protectRelayText(input: string): {
  text: string;
  restore: (result: string) => string;
} {
  if (input.length > 4000 || !input.trim())
    throw new RelayProtectionError("Text is empty or exceeds the safe relay limit");
  if (sensitive.test(input))
    throw new RelayProtectionError("Possible secrets: relay is disabled for this request");
  if (fullJson(input)) throw new RelayProtectionError("Structured JSON is not translated");
  const fragments: string[] = [];
  const text = input.replace(protectedSpans, (span) => {
    const key = `KM_PROTECTED_${String(fragments.length).padStart(4, "0")}_END`;
    if (input.includes(key)) throw new RelayProtectionError("Ambiguous protected token");
    fragments.push(span);
    return key;
  });
  return {
    text,
    restore: (result: string) => {
      if (result.length > 12000) throw new RelayProtectionError("Translation exceeded safe size");
      for (let i = 0; i < fragments.length; i++) {
        const marker = `KM_PROTECTED_${String(i).padStart(4, "0")}_END`;
        if (result.split(marker).length !== 2)
          throw new RelayProtectionError("Protected content was modified by translation");
        result = result.replace(marker, fragments[i]!);
      }
      if (/KM_PROTECTED_\d+_END/.test(result))
        throw new RelayProtectionError("Translation added unknown protected spans");
      return result;
    }
  };
}
