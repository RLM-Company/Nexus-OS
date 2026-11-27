import { MembershipError, type ProjectMembershipStore } from "@cosmora/db";
import type { ProjectRole } from "@cosmora/contracts";

/** Resolves the owner of data for this operation only. The acting identity stays intact. */
export function projectAccess(
  membership: ProjectMembershipStore | undefined,
  projectId: string,
  actorAccount: string,
  minimum: ProjectRole | "any" = "any"
) {
  if (!membership)
    return { projectId, accountId: actorAccount, ownerId: actorAccount, role: "owner" as const };
  try {
    return membership.access(projectId, actorAccount, minimum);
  } catch (error) {
    if (error instanceof MembershipError && error.code === "OWNER_DATA_FENCED") return null;
    throw error;
  }
}
