import { parseGameProjectV2, type GameProjectV2 } from "@cosmora/contracts/game-project-v2";

/** Editing state for the inert obj-lite model markers. No mesh vertices are changed. */
export type ModelTransform = { rotation: string; scale: string };
export type RenderSettings = {
  camera: string; // "x,y,z,fov"
  light: string; // "x,y,z,intensity"
  color: string; // "#rrggbb"
  wireframe: boolean;
};

/** A structured, addressable change to one field of a v2 project. Other fields stay byte-identical. */
export type V2FieldEdit =
  | { field: "title"; value: string }
  | { field: "scene_html"; value: string }
  | { field: "styles_css"; value: string }
  | { field: "game_js"; value: string }
  | { field: "launch"; value: GameProjectV2["launch"] }
  | { field: "scene"; id: string; value: { title: string; html: string } }
  | { field: "model_transform"; name: string; value: ModelTransform }
  | { field: "model_render"; name: string; value: RenderSettings }
  | { field: "asset_add"; value: GameProjectV2["assets"][number] }
  | { field: "asset_remove"; name: string };

export type V2EditResult =
  { ok: true; json: string; project: GameProjectV2 } | { ok: false; error: string };

const TRANSFORM_MARKER = "# kosmora-transform:";
const RENDER_MARKER = "# kosmora-render:";

const DEFAULT_TRANSFORM: ModelTransform = { rotation: "0.25,0.45", scale: "1" };
const DEFAULT_RENDER: RenderSettings = {
  camera: "0,1.5,5,50",
  light: "3,4,5,2",
  color: "#62d9b0",
  wireframe: false
};

/** Parse all `# kosmora-*` markers without touching vertex/face lines. */
export function readModelMarkers(data: string): {
  transform: ModelTransform;
  render: RenderSettings;
} {
  const transformLine = /# kosmora-transform:([^\r\n]*)/.exec(data)?.[1] ?? "";
  const renderLine = /# kosmora-render:([^\r\n]*)/.exec(data)?.[1] ?? "";
  const rotation = /rotation=([^;\s]+)/.exec(transformLine)?.[1] ?? DEFAULT_TRANSFORM.rotation;
  const scale = /scale=([^;\s]+)/.exec(transformLine)?.[1] ?? DEFAULT_TRANSFORM.scale;
  const camera = /camera=([^;\s]+)/.exec(renderLine)?.[1] ?? DEFAULT_RENDER.camera;
  const light = /light=([^;\s]+)/.exec(renderLine)?.[1] ?? DEFAULT_RENDER.light;
  const rawColor = /color=([^;\s]+)/.exec(renderLine)?.[1] ?? DEFAULT_RENDER.color;
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : DEFAULT_RENDER.color;
  const wireframe = /wireframe=1/.test(renderLine);
  return { transform: { rotation, scale }, render: { camera, light, color, wireframe } };
}

/** Replace only the requested marker line; vertex/face lines remain byte-identical. */
function writeModelMarker(data: string, marker: string, payload: string): string {
  const without = data
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(marker))
    .join("\n")
    .replace(/^\n+/, "");
  return `${marker}${payload}\n${without}`;
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
      const model = checkModel(next, edit.name);
      if (!model.ok) return model;
      next.model = {
        ...model.value,
        data: writeModelMarker(
          model.value.data,
          TRANSFORM_MARKER,
          `rotation=${edit.value.rotation};scale=${edit.value.scale}`
        )
      };
      break;
    }
    case "model_render": {
      const model = checkModel(next, edit.name);
      if (!model.ok) return model;
      const { camera, light, color, wireframe } = edit.value;
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: "INVALID_COLOR" };
      next.model = {
        ...model.value,
        data: writeModelMarker(
          model.value.data,
          RENDER_MARKER,
          `camera=${camera};light=${light};color=${color};wireframe=${wireframe ? 1 : 0}`
        )
      };
      break;
    }
    case "asset_add": {
      if (next.assets.some((asset) => asset.name === edit.value.name))
        return { ok: false, error: "ASSET_EXISTS" };
      next.assets = [...next.assets, edit.value];
      break;
    }
    case "asset_remove": {
      if (!next.assets.some((asset) => asset.name === edit.name))
        return { ok: false, error: "ASSET_NOT_FOUND" };
      next.assets = next.assets.filter((asset) => asset.name !== edit.name);
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

function checkModel(
  project: GameProjectV2,
  name: string
): { ok: true; value: NonNullable<GameProjectV2["model"]> } | { ok: false; error: string } {
  if (!project.model) return { ok: false, error: "MODEL_NOT_FOUND" };
  if (project.model.name !== name) return { ok: false, error: "MODEL_NAME_MISMATCH" };
  if (project.model.format !== "obj-lite") return { ok: false, error: "MODEL_FORMAT_UNSUPPORTED" };
  return { ok: true, value: project.model };
}

const tuple4 = (value: string, fallback: string): [number, number, number, number] => {
  const parts = value.split(",").map((part) => Number(part));
  const base = fallback.split(",").map((part) => Number(part));
  return [
    parts[0] ?? base[0] ?? 0,
    parts[1] ?? base[1] ?? 0,
    parts[2] ?? base[2] ?? 0,
    parts[3] ?? base[3] ?? 0
  ].map((n, i) => (Number.isFinite(n) ? n : (base[i] ?? 0))) as [number, number, number, number];
};

/** Map the v2 model markers to the real runtime descriptor with safe defaults. */
export function v2SceneDescriptor(project: GameProjectV2) {
  const markers = project.model ? readModelMarkers(project.model.data) : null;
  const [rx, ry] = tuple4(
    markers?.transform.rotation ?? DEFAULT_TRANSFORM.rotation,
    "0.25,0.45,0,0"
  );
  const [scale] = tuple4(markers?.transform.scale ?? DEFAULT_TRANSFORM.scale, "1,0,0,0");
  const [cx, cy, cz, fov] = tuple4(markers?.render.camera ?? DEFAULT_RENDER.camera, "0,1.5,5,50");
  const [lx, ly, lz, intensity] = tuple4(markers?.render.light ?? DEFAULT_RENDER.light, "3,4,5,2");
  return {
    rotation: { x: rx, y: ry },
    scale,
    camera: { x: cx, y: cy, z: cz, fov },
    light: { x: lx, y: ly, z: lz, intensity },
    material: {
      color: markers?.render.color ?? DEFAULT_RENDER.color,
      wireframe: markers?.render.wireframe ?? false,
      metalness: 0.1,
      roughness: 0.6
    }
  };
}

/** Read the current addressable fields for the editor panel. */
export function readV2Editable(source: string):
  | {
      ok: true;
      title: string;
      launch: GameProjectV2["launch"];
      scenes: GameProjectV2["scenes"];
      transform: ModelTransform | null;
      render: RenderSettings | null;
      modelName: string | null;
      assets: GameProjectV2["assets"];
    }
  | { ok: false; error: string } {
  let project: GameProjectV2;
  try {
    project = parseGameProjectV2(source);
  } catch {
    return { ok: false, error: "INVALID_GAME_PROJECT_V2" };
  }
  const markers = project.model ? readModelMarkers(project.model.data) : null;
  return {
    ok: true,
    title: project.title,
    launch: project.launch,
    scenes: project.scenes,
    transform: markers?.transform ?? null,
    render: markers?.render ?? null,
    modelName: project.model?.name ?? null,
    assets: project.assets
  };
}
