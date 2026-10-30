/** Conservative known credential patterns, not a general DLP or personal-data detector. */
export const memoryContainsCredential = (text: string): boolean =>
  /(?:\bBearer\s+\S+|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|пароль(?:\s+(?:панели|входа|аккаунта))?\s*[:=]\s*\S+|(?:\botp\b|\bpin\b|одноразовый\s+код|код\s+подтверждения)\s*[:=]\s*\d{4,8}|\b(?:gh[opsur]_|github_pat_|sk-)[a-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu.test(
    text
  );
