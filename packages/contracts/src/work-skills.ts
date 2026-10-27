import type { ChatSkillSnapshot } from "./chat-skills.js";

/** Accepted instructions are inert user preferences, never tool authority. */
export type AcceptedWorkSkills = {
  selection_version: number;
  items: ChatSkillSnapshot[];
  captured_at: string | null;
  source: "project" | "plan" | "legacy";
  source_id: string | null;
};
