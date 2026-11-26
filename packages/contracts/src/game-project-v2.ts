/**
 * Additive extension for richer Games projects (assets, scenes, launch settings,
 * lightweight 3D models). This is a NEW format; `kosmora.game-project.v1` stays
 * unchanged and keeps validating/executing exactly as before.
 *
 * INTEGRATION: owned by Codex. This file is additive and exported from the
 * package root. It grants no new permissions: every field is inert structured
 * data, the runtime still executes untrusted code only in the isolated Worker.
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const GAME_PROJECT_V2_FORMAT = "kosmora.game-project.v2" as const;
export const GAME_PROJECT_V2_MAX_BYTES = 512 * 1024;
export const GAME_ASSET_MAX_BYTES = 128 * 1024;
export const GAME_MODEL_MAX_BYTES = 128 * 1024;

const boundedString = (max: number) => Type.String({ maxLength: max });
const asset = Type.Object(
  {
    name: Type.String({ pattern: "^[A-Za-z0-9._-]{1,80}$", minLength: 1 }),
    media_type: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
      Type.Literal("text/plain")
    ]),
    // Base64 only. No external URLs, no data fetched at runtime.
    data_base64: Type.String({
      pattern: "^[A-Za-z0-9+/]+={0,2}$",
      maxLength: GAME_ASSET_MAX_BYTES * 2
    })
  },
  { additionalProperties: false }
);

export const GameProjectV2Schema = Type.Object(
  {
    format: Type.Literal(GAME_PROJECT_V2_FORMAT),
    title: boundedString(120),
    files: Type.Object(
      {
        scene_html: boundedString(64000),
        styles_css: boundedString(64000),
        game_js: boundedString(64000)
      },
      { additionalProperties: false }
    ),
    launch: Type.Object(
      {
        // Worker-based browser game (v1-compatible) or the sandboxed 3D preview.
        runtime: Type.Union([Type.Literal("canvas2d_worker"), Type.Literal("web3d_sandbox")]),
        auto_start: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    // Static sprite/HUD assets embedded as base64. No network fetching.
    assets: Type.Array(asset, { maxItems: 32 }),
    scenes: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^[A-Za-z0-9_-]{1,60}$" }),
          title: boundedString(120),
          html: boundedString(16000)
        },
        { additionalProperties: false }
      ),
      { maxItems: 32 }
    ),
    // A single lightweight glTF/OBJ JSON model, inert until the 3D sandbox parses it.
    model: Type.Union([
      Type.Null(),
      Type.Object(
        {
          name: Type.String({ pattern: "^[A-Za-z0-9._-]{1,80}$" }),
          format: Type.Union([Type.Literal("gltf-json"), Type.Literal("obj-lite")]),
          data: boundedString(GAME_MODEL_MAX_BYTES)
        },
        { additionalProperties: false }
      )
    ])
  },
  { additionalProperties: false }
);

export type GameProjectV2 = Static<typeof GameProjectV2Schema>;

export function parseGameProjectV2(source: string): GameProjectV2 {
  const bytes = new TextEncoder().encode(source).length;
  if (!bytes || bytes > GAME_PROJECT_V2_MAX_BYTES) throw Error("INVALID_GAME_PROJECT_V2");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw Error("INVALID_GAME_PROJECT_V2");
  }
  if (!Value.Check(GameProjectV2Schema, value)) throw Error("INVALID_GAME_PROJECT_V2");
  const project = value as GameProjectV2;
  // Verify canonical base64 shape without decoding to a URL or fetching data.
  for (const a of project.assets) {
    const data = a.data_base64;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
      throw Error("INVALID_GAME_PROJECT_V2");
    }
  }
  return project;
}

export const GAME_PROJECT_V2_INSTRUCTION = `Create a complete project in format ${GAME_PROJECT_V2_FORMAT}: a title, three source strings (scene_html, styles_css, game_js), a launch object, a list of embedded base64 assets, static scenes and optionally one lightweight 3D model. No external URLs, imports, DOM, network or native engines. Assets are inert base64; the host decides how to present them. A 3D model is gltf-json or obj-lite structured data only. Keep everything bounded and self-contained.`;
