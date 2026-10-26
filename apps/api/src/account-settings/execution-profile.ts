export const MODEL_PROFILES = [
  { id: "mercurius", name: "Kosmora Mercurius", description: "Быстрые повседневные задачи" },
  { id: "mars", name: "Kosmora Mars", description: "Работа, документы и код" },
  { id: "jupiter", name: "Kosmora Jupiter", description: "Сложные задачи и глубокая проработка" },
  { id: "saturnus", name: "Kosmora Saturnus", description: "Планы и многошаговая работа" }
] as const;
export type ModelProfileId = (typeof MODEL_PROFILES)[number]["id"];
export type ExecutionPreferences = {
  version: number;
  model_profile: ModelProfileId;
  autonomy: number;
  turbo: boolean;
};
export const EXECUTION_SCHEMA = `CREATE TABLE IF NOT EXISTS kosmora_execution_preferences (
  owner_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version>=1),
  model_profile TEXT NOT NULL CHECK(model_profile IN ('mercurius','mars','jupiter','saturnus')),
  autonomy INTEGER NOT NULL CHECK(autonomy BETWEEN 0 AND 6),
  turbo INTEGER NOT NULL CHECK(turbo IN (0,1)),
  updated_at TEXT NOT NULL
);`;
export const MEDIA_USAGE_SCHEMA = `CREATE TABLE IF NOT EXISTS kosmora_media_usage (
  operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  hold_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','committed','uncertain','cancelled')),
  reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>0),
  input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL
);`;
