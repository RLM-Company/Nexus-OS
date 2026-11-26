import { Type, type Static } from "typebox";

const id = Type.String({ minLength: 1, maxLength: 128 });
export const ProjectRoleSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("editor"),
  Type.Literal("viewer")
]);
export type ProjectRole = Static<typeof ProjectRoleSchema>;

export const ProjectMemberInviteSchema = Type.Object(
  {
    account_id: id,
    role: Type.Union([Type.Literal("editor"), Type.Literal("viewer")])
  },
  { additionalProperties: false }
);
export type ProjectMemberInvite = Static<typeof ProjectMemberInviteSchema>;

export const ProjectMemberViewSchema = Type.Object(
  {
    account_id: id,
    role: ProjectRoleSchema,
    status: Type.Union([Type.Literal("invited"), Type.Literal("active")]),
    invited_at: Type.String({ maxLength: 40 }),
    accepted_at: Type.Union([Type.String({ maxLength: 40 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type ProjectMemberView = Static<typeof ProjectMemberViewSchema>;

export const ProjectMembersViewSchema = Type.Object(
  {
    project_id: id,
    members: Type.Array(ProjectMemberViewSchema, { maxItems: 100 })
  },
  { additionalProperties: false }
);
export type ProjectMembersView = Static<typeof ProjectMembersViewSchema>;
