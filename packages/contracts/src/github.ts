import { Type, type Static } from "typebox";

export const GitHubRepositorySchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    owner: Type.String({ minLength: 1, maxLength: 100 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    default_branch: Type.String({ minLength: 1, maxLength: 255 }),
    visibility: Type.Union([Type.Literal("private"), Type.Literal("public")]),
    web_url: Type.String({ format: "uri", maxLength: 2048 })
  },
  { additionalProperties: false }
);
export type GitHubRepository = Static<typeof GitHubRepositorySchema>;

export const GitHubBranchSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    protected: Type.Boolean(),
    last_commit_sha: Type.String({ minLength: 1, maxLength: 128 })
  },
  { additionalProperties: false }
);
export type GitHubBranch = Static<typeof GitHubBranchSchema>;

export const GitHubCommitSchema = Type.Object(
  {
    sha: Type.String({ minLength: 1, maxLength: 128 }),
    short_sha: Type.String({ minLength: 1, maxLength: 16 }),
    message: Type.String({ minLength: 1, maxLength: 500 }),
    author: Type.String({ minLength: 1, maxLength: 255 })
  },
  { additionalProperties: false }
);
export type GitHubCommit = Static<typeof GitHubCommitSchema>;

export const GitHubIssueSchema = Type.Object(
  {
    number: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    state: Type.Union([Type.Literal("open"), Type.Literal("closed")])
  },
  { additionalProperties: false }
);
export type GitHubIssue = Static<typeof GitHubIssueSchema>;

export const GitHubPullRequestSchema = Type.Object(
  {
    number: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    state: Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("merged")]),
    source_branch: Type.String({ minLength: 1, maxLength: 255 }),
    target_branch: Type.String({ minLength: 1, maxLength: 255 })
  },
  { additionalProperties: false }
);
export type GitHubPullRequest = Static<typeof GitHubPullRequestSchema>;

export const GitHubCiStatusSchema = Type.Object(
  {
    sha: Type.String({ minLength: 1, maxLength: 128 }),
    state: Type.Union([
      Type.Literal("success"),
      Type.Literal("failure"),
      Type.Literal("pending"),
      Type.Literal("cancelled")
    ]),
    checks: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 255 }),
          conclusion: Type.Union([
            Type.Literal("success"),
            Type.Literal("failure"),
            Type.Literal("pending")
          ])
        },
        { additionalProperties: false }
      ),
      { maxItems: 20 }
    )
  },
  { additionalProperties: false }
);
export type GitHubCiStatus = Static<typeof GitHubCiStatusSchema>;

export const GitHubRepositoryListResponseSchema = Type.Object(
  { items: Type.Array(GitHubRepositorySchema, { maxItems: 50 }) },
  { additionalProperties: false }
);
export type GitHubRepositoryListResponse = Static<typeof GitHubRepositoryListResponseSchema>;

export const GitHubRepositorySummarySchema = Type.Object(
  {
    repository: GitHubRepositorySchema,
    branches: Type.Array(GitHubBranchSchema, { maxItems: 20 }),
    commits: Type.Array(GitHubCommitSchema, { maxItems: 20 }),
    issues: Type.Array(GitHubIssueSchema, { maxItems: 20 }),
    pull_requests: Type.Array(GitHubPullRequestSchema, { maxItems: 20 }),
    ci: GitHubCiStatusSchema
  },
  { additionalProperties: false }
);
export type GitHubRepositorySummary = Static<typeof GitHubRepositorySummarySchema>;

export const GitHubConnectionStatusSchema = Type.Object(
  { configured: Type.Boolean(), mode: Type.Literal("read_only") },
  { additionalProperties: false }
);
export type GitHubConnectionStatus = Static<typeof GitHubConnectionStatusSchema>;
