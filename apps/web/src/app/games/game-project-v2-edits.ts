import { parseGameProjectV2, type GameProjectV2 } from "@cosmora/contracts/game-project-v2";

/** A structured, addressable change to one field of a v2 project. Other fields stay byte-identical. */
export type V2FieldEdit =
  | { field: "title"; value: string }
  | { field: "scene_html"; value: string }
  | { field: "styles_css"; value: string }
  | { field: "game_js"; value: string }
  | { field: "launch"; value: GameProjectV2["launch"] }
  | { field: "scene"; id: string; value: { title: string; html: string } }
  | { field: "model_transform"; name: string; value: { rotation: string; scale: string } };

export type V2EditResult =
  { ok: true; json: string; project: GameProjectV2 } | { ok: false; error: string };

const TRANSFORM_MARKER = "# kosmora-transform:";

function transformFromHtml(html: string): { rotation: string; scale: string } {
  const match = /# kosmora-transform:([^\r\n]*)/.exec(html);
  if (!match) return { rotation: "0.25,0.45", scale: "1" };
  const rotation = /rotation=([^;\s]+)/.exec(match[1] ?? "")?.[1] ?? "0.25,0.45";
  const scale = /scale=([^;\s]+)/.exec(match[1] ?? "")?.[1] ?? "1";
  return { rotation, scale };
}

function applyTransform(html: string, value: { rotation: string; scale: string }): string {
  const marker = `${TRANSFORM_MARKER}rotation=${value.rotation};scale=${value.scale}`;
  const without = html.replace(/# kosmora-transform:[^\r\n]*\r?\n?/g, "");
  return `${marker}\n${without}`;
}

/**
 * Apply one structured edit. Returns a reversible JSON snapshot only when the
 * result still validates against the v2 contract; invalid input never overwrites.
 */
export function applyV2FieldEdit(source: string, edit: V2FieldEdit): V2EditResult {
  let base: GameProjectV2;
  try {
    base = parseGameProjectV2(source);
  } catch {
    return { ok: false, error: "INVALID_GAME_PROJECT_V2" };
  }
  const next: GameProjectV2 = structuredClone(base);
  switch (edit.field) {
    case "title":
      next.title = edit.value;
      break;
    case "scene_html":
      next.files.scene_html = edit.value;
      break;
    case "styles_css":
      next.files.styles_css = edit.value;
      break;
    case "game_js":
      next.files.game_js = edit.value;
      break;
    case "launch":
      next.launch = edit.value;
      break;
    case "scene": {
      const index = next.scenes.findIndex((scene) => scene.id === edit.id);
      if (index < 0) return { ok: false, error: "SCENE_NOT_FOUND" };
      next.scenes[index] = { id: edit.id, title: edit.value.title, html: edit.value.html };
      break;
    }
    case "model_transform": {
      if (!next.model) return { ok: false, error: "MODEL_NOT_FOUND" };
      if (next.model.name !== edit.name) return { ok: false, error: "MODEL_NAME_MISMATCH" };
      if (next.model.format !== "obj-lite") return { ok: false, error: "MODEL_FORMAT_UNSUPPORTED" };
      next.model = { ...next.model, data: applyTransform(next.model.data, edit.value) };
      break;
    }
  }
  const json = JSON.stringify(next, null, 2);
  try {
    return { ok: true, json, project: parseGameProjectV2(json) };
  } catch {
    return { ok: false, error: "RESULT_INVALID" };
  }
}

/** Map the v2 transform marker to the real runtime descriptor with safe defaults. */
export function v2SceneDescriptor(project: GameProjectV2) {
  const transform = project.model ? transformFromHtml(project.model.data) : null;
  const [rx, ry] = (transform?.rotation ?? "0.25,0.45").split(",").map(Number);
  return {
    rotation: {
      x: typeof rx === "number" && Number.isFinite(rx) ? rx : 0.25,
      y: typeof ry === "number" && Number.isFinite(ry) ? ry : 0.45
    },
    scale: Number(transform?.scale) || 1,
    camera: { x: 0, y: 1.5, z: 5, fov: 50 },
    light: { x: 3, y: 4, z: 5, intensity: 2 },
    material: { color: "#62d9b0", wireframe: false, metalness: 0.1, roughness: 0.6 }
  };
}

/** Read the current addressable scene/model transform for the editor fields. */
export function readV2Editable(source: string):
  | {
      ok: true;
      title: string;
      launch: GameProjectV2["launch"];
      scenes: GameProjectV2["scenes"];
      transform: { rotation: string; scale: string } | null;
      modelName: string | null;
    }
  | { ok: false; error: string } {
  let project: GameProjectV2;
  try {
    project = parseGameProjectV2(source);
  } catch {
    return { ok: false, error: "INVALID_GAME_PROJECT_V2" };
  }
  return {
    ok: true,
    title: project.title,
    launch: project.launch,
    scenes: project.scenes,
    transform: project.model ? transformFromHtml(project.model.data) : null,
    modelName: project.model?.name ?? null
  };
}
