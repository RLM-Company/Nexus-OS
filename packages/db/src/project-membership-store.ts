import type { DatabaseSync } from "node:sqlite";
import { Value } from "typebox/value";
import {
  ProjectMemberInviteSchema,
  ProjectMembersViewSchema,
  type ProjectMemberView,
  type ProjectMembersView,
  type ProjectRole
} from "@cosmora/contracts";

class MembershipError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "OWNER_DATA_FENCED",
    message = code
  ) {
    super(message);
  }
}

/** Project membership with explicit invitation, acceptance, leave and owner revoke. */
export class ProjectMembershipStore {
  constructor(private readonly db: DatabaseSync) {}

  private active(owner: string) {
    const row = this.db
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(owner) as { state: string } | undefined;
    if (row && row.state !== "active") throw new MembershipError("OWNER_DATA_FENCED");
  }

  private ownedProject(projectId: string, owner: string) {
    const row = this.db
      .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?")
      .get(projectId, owner);
    if (!row) throw new MembershipError("NOT_FOUND");
  }

  members(projectId: string, owner: string): ProjectMembersView {
    this.active(owner);
    const owned = this.db
      .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=?")
      .get(projectId, owner);
    if (!owned && !this.canAccess(projectId, owner)) throw new MembershipError("NOT_FOUND");
    const rows = this.db
      .prepare(
        "SELECT account_id,role,status,invited_at,accepted_at FROM project_members WHERE project_id=? ORDER BY account_id LIMIT 100"
      )
      .all(projectId) as ProjectMemberView[];
    const view: ProjectMembersView = { project_id: projectId, members: rows };
    if (!Value.Check(ProjectMembersViewSchema, view)) throw new Error("INVALID_MEMBERS_VIEW");
    return view;
  }

  invite(projectId: string, owner: string, input: unknown): ProjectMembersView {
    this.active(owner);
    this.ownedProject(projectId, owner);
    if (!Value.Check(ProjectMemberInviteSchema, input)) throw new MembershipError("CONFLICT");
    const at = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO project_members(project_id,account_id,owner_id,role,status,invited_at,accepted_at) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(project_id,account_id) DO NOTHING"
      )
      .run(projectId, input.account_id, owner, input.role, "invited", at);
    return this.members(projectId, owner);
  }

  accept(projectId: string, accountId: string): ProjectMembersView {
    this.active(accountId);
    const row = this.db
      .prepare(
        "SELECT m.status, p.owner_id FROM project_members m JOIN projects p ON p.id=m.project_id AND p.owner_id=m.owner_id WHERE m.project_id=? AND m.account_id=?"
      )
      .get(projectId, accountId) as { status: string; owner_id: string } | undefined;
    if (!row || row.status !== "invited") throw new MembershipError("NOT_FOUND");
    this.active(row.owner_id);
    this.db
      .prepare(
        "UPDATE project_members SET status='active', accepted_at=? WHERE project_id=? AND account_id=?"
      )
      .run(new Date().toISOString(), projectId, accountId);
    return this.members(projectId, accountId);
  }

  leave(projectId: string, accountId: string): void {
    this.active(accountId);
    const result = this.db
      .prepare("DELETE FROM project_members WHERE project_id=? AND account_id=? AND role!='owner'")
      .run(projectId, accountId);
    if (!result.changes) throw new MembershipError("NOT_FOUND");
  }

  revoke(projectId: string, owner: string, accountId: string): ProjectMembersView {
    this.active(owner);
    this.ownedProject(projectId, owner);
    const result = this.db
      .prepare("DELETE FROM project_members WHERE project_id=? AND account_id=? AND role!='owner'")
      .run(projectId, accountId);
    if (!result.changes) throw new MembershipError("NOT_FOUND");
    return this.members(projectId, owner);
  }

  /** Active membership is required for reading, search, download and actions. */
  canAccess(projectId: string, accountId: string, role: ProjectRole | "any" = "any"): boolean {
    return this.access(projectId, accountId, role) !== null;
  }

  access(projectId: string, accountId: string, role: ProjectRole | "any" = "any") {
    this.active(accountId);
    const project = this.db.prepare("SELECT owner_id FROM projects WHERE id=?").get(projectId) as
      { owner_id: string } | undefined;
    if (!project) return null;
    const ownerId = project.owner_id;
    const member =
      ownerId === accountId
        ? { role: "owner" as const }
        : (this.db
            .prepare(
              "SELECT role FROM project_members WHERE project_id=? AND owner_id=? AND account_id=? AND status='active' AND role IN ('viewer','editor')"
            )
            .get(projectId, ownerId, accountId) as { role: ProjectRole } | undefined);
    if (!member) return null;
    const rank: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };
    if (role !== "any" && rank[member.role] < rank[role]) return null;
    this.active(ownerId);
    return { accountId, projectId, ownerId, role: member.role };
  }

  requireAccess(projectId: string, accountId: string): void {
    if (!this.canAccess(projectId, accountId)) throw new MembershipError("FORBIDDEN");
  }
}

export { MembershipError };
