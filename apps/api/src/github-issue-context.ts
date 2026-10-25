import { Type } from "typebox";

/** Quoted user-reviewed source material. This grants no tool, network or publication authority. */
export type GithubIssueContext = {
  repository: string;
  number: number;
  title: string;
  body: string;
  source_body_chars: number;
  source_updated_at: string;
  truncated: boolean;
  truncation_approved: boolean;
};
export const githubIssueContextSchema = Type.Object(
  {
    repository: Type.String({ minLength: 1, maxLength: 240 }),
    number: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
    title: Type.String({ maxLength: 512 }),
    body: Type.String({ maxLength: 7000 }),
    source_body_chars: Type.Integer({ minimum: 0, maximum: 100_000 }),
    source_updated_at: Type.String({ minLength: 1, maxLength: 40 }),
    truncated: Type.Boolean(),
    truncation_approved: Type.Boolean()
  },
  { additionalProperties: false }
);
export function validGithubIssueContext(
  value: GithubIssueContext,
  repository: string,
  task: string
): boolean {
  return (
    value.repository === repository &&
    Number.isSafeInteger(value.number) &&
    value.number >= 1 &&
    value.number <= 2_147_483_647 &&
    typeof value.title === "string" &&
    value.title.length <= 512 &&
    typeof value.body === "string" &&
    value.body.length <= 7000 &&
    Number.isInteger(value.source_body_chars) &&
    value.source_body_chars >= 0 &&
    value.source_body_chars <= 100_000 &&
    typeof value.source_updated_at === "string" &&
    value.source_updated_at.length <= 40 &&
    Number.isFinite(Date.parse(value.source_updated_at)) &&
    typeof value.truncated === "boolean" &&
    typeof value.truncation_approved === "boolean" &&
    (!(value.truncated || value.body.length < value.source_body_chars) ||
      (value.truncated && value.truncation_approved)) &&
    task.length + JSON.stringify(value).length <= 8000
  );
}
