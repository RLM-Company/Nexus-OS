import { Type, type Static } from "typebox";

export const CHAT_SKILLS_MAX_COUNT = 3;
export const CHAT_SKILLS_MAX_BYTES = 16_000;
export const ChatSkillReferenceSchema = Type.Object(
  {
    skill_id: Type.String({ minLength: 1, maxLength: 160 }),
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  },
  { additionalProperties: false }
);
export type ChatSkillReference = Static<typeof ChatSkillReferenceSchema>;
/** Where a rule came from. Optional for older run snapshots; the active stores
 * always fill it. Precedence is fixed: task > chat > project > owner. */
export type ChatSkillScope = "owner" | "project" | "chat" | "task";
export const CHAT_SKILL_PRECEDENCE: readonly ChatSkillScope[] = [
  "task",
  "chat",
  "project",
  "owner"
];
export type ChatSkillSnapshot = ChatSkillReference & {
  name: string;
  summary: string;
  instructions: string;
  scope?: ChatSkillScope;
};
export type ChatSkillSelection = {
  version: number;
  updated_at: string | null;
  items: ChatSkillSnapshot[];
};
export const UpdateChatSkillsSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
    items: Type.Array(ChatSkillReferenceSchema, { maxItems: CHAT_SKILLS_MAX_COUNT })
  },
  { additionalProperties: false }
);

/** A rule suggested from one explicit owner correction. Never inferred from
 * personality, other chats or model output: `correction` is the owner's text. */
export const SkillCorrectionProposalSchema = Type.Object(
  {
    correction: Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" })
  },
  { additionalProperties: false }
);
export type SkillCorrectionProposal = Static<typeof SkillCorrectionProposalSchema>;
export type SkillCorrectionDraft = {
  format: "kosmora.skill-correction.v1";
  name: string;
  summary: string;
  instructions: string;
  /** Informational only; the draft is inert until the owner explicitly accepts. */
  source: "owner_correction";
  accepted: false;
};
export const AcceptSkillCorrectionSchema = Type.Object(
  {
    client_request_id: Type.String({
      pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
    }),
    draft: Type.Object(
      {
        format: Type.Literal("kosmora.skill-correction.v1"),
        name: Type.String({ minLength: 1, maxLength: 80 }),
        summary: Type.String({ minLength: 1, maxLength: 240 }),
        instructions: Type.String({ minLength: 1, maxLength: 20_000 })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);
export type AcceptSkillCorrection = Static<typeof AcceptSkillCorrectionSchema>;

/** Deterministic, model-free check of an answer against explicit criteria.
 * It measures STYLE/STRUCTURE ONLY: never truth, intelligence or benchmark gain. */
export const SkillResultEvaluationSchema = Type.Object(
  {
    source: Type.String({ minLength: 1, maxLength: 20_000 }),
    answer: Type.String({ minLength: 1, maxLength: 20_000 }),
    /** Facts that must survive from the source (numbers, codes, dates, names). */
    required_facts: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 32 }),
    /** Explicit prohibitions; each is a literal that must NOT appear in the answer. */
    forbidden: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 32 }),
    /** "bullets" requires a list-like answer; "plain" requires no list markers. */
    format: Type.Union([Type.Literal("bullets"), Type.Literal("plain"), Type.Literal("any")])
  },
  { additionalProperties: false }
);
export type SkillResultEvaluation = Static<typeof SkillResultEvaluationSchema>;
export type SkillResultCheck = {
  criterion: "format" | "facts_preserved" | "constraints_followed";
  passed: boolean;
  /** Factual description, never a score or a confidence value. */
  detail: string;
};
export type SkillResultReport = {
  format: "kosmora.skill-result-evaluation.v1";
  passed: boolean;
  checks: SkillResultCheck[];
  /** Always present: this evaluator does not verify truth or model quality. */
  not_checked: ["truth", "intelligence", "benchmark_gain"];
};
