import { ResearchSessionRecord } from "./contracts";

export class InMemoryResearchStore {
  private readonly sessions = new Map<string, ResearchSessionRecord>();

  saveSession(record: ResearchSessionRecord): ResearchSessionRecord {
    const clone = JSON.parse(JSON.stringify(record)) as ResearchSessionRecord;
    this.sessions.set(clone.sessionId, clone);
    return clone;
  }

  getSession(sessionId: string): ResearchSessionRecord | null {
    const found = this.sessions.get(sessionId);
    return found ? (JSON.parse(JSON.stringify(found)) as ResearchSessionRecord) : null;
  }

  listSessions(projectId?: string): ResearchSessionRecord[] {
    const all = Array.from(this.sessions.values()).map(
      (item) => JSON.parse(JSON.stringify(item)) as ResearchSessionRecord
    );
    if (!projectId) return all;
    return all.filter((item) => item.projectId === projectId);
  }
}
