export interface GraphImportAttempt {
  creation_key: string;
  sha256: string;
}
/** Only a receipt key and digest; document text is never put in browser storage. */
export const graphImportAttemptSlot = (projectId: string) =>
  `kosmora.graph-import.v1:${encodeURIComponent(projectId)}`;
export function parseGraphImportAttempt(text: string | null): GraphImportAttempt | null {
  if (text === null) return null;
  if (text.length > 512) throw new Error("Invalid saved import attempt");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved import attempt");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.creation_key !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(record.creation_key) ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  )
    throw new Error("Invalid saved import attempt");
  return { creation_key: record.creation_key, sha256: record.sha256 };
}
