/**
 * Real-time Zero-Trust Secret Masking Stream for Kosmora.
 */

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  {
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/gu,
    replacement: "[REDACTED_API_KEY]"
  },
  {
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/gu,
    replacement: "[REDACTED_GITHUB_TOKEN]"
  },
  {
    regex: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}\b/giu,
    replacement: "Bearer [REDACTED_TOKEN]"
  },
  {
    regex: /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*["']?)[A-Za-z0-9_!@#$%^&*()-+=]{12,}(["']?)/giu,
    replacement: "$1[REDACTED_CREDENTIAL]$2"
  },
  {
    regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/gu,
    replacement: "[REDACTED_AWS_KEY]"
  }
];

export function maskSecrets(text: string): string {
  if (!text) return "";
  let sanitized = text;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

export interface SecretAuditDetection {
  type: string;
  index: number;
}

export function detectSecrets(text: string): SecretAuditDetection[] {
  if (!text) return [];
  const detections: SecretAuditDetection[] = [];
  for (const { regex, replacement } of SECRET_PATTERNS) {
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = r.exec(text)) !== null) {
      detections.push({
        type: replacement.replace(/[[\]]/g, ""),
        index: match.index
      });
    }
  }
  return detections;
}
