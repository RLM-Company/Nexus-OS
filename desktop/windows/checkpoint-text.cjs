"use strict";

// Shared exclusions for persisted task goals and Work plan labels.
const SENSITIVE =
  /(?:\bBearer\s+\S+|\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+|пароль\s*[:=]?\s*\S+|(?:\b(?:pin|code)\b|код)\s*[:=—-]?\s*\d{4,8}|\b(?:gh[opsur]_|github_pat_|sk-)[a-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu;
const containsCredentialText = (text) => SENSITIVE.test(text);
module.exports = { containsCredentialText };
