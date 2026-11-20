export type CodeSnapshotStamp = {
  id: string;
  version?: number | null | undefined;
  sequence: number;
};

const knownVersion = (version: number | null | undefined): number | null =>
  typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? version : null;

/** Durable revisions take precedence; request order also protects legacy servers. */
export function acceptsCodeSnapshot(
  previous: CodeSnapshotStamp | null,
  incoming: { id: string; version?: number | null | undefined },
  sequence: number
): boolean {
  if (!previous || previous.id !== incoming.id) return true;
  const currentVersion = knownVersion(previous.version);
  const nextVersion = knownVersion(incoming.version);
  if (currentVersion !== null) {
    if (nextVersion === null) return false;
    if (nextVersion !== currentVersion) return nextVersion > currentVersion;
  }
  return sequence >= previous.sequence;
}
