export const GAME_PROJECT_FILES = ["scene.html", "styles.css", "game.js"] as const;
export type GameProjectFile = (typeof GAME_PROJECT_FILES)[number];
export type GameProject = {
  format: "kosmora.game-project.v1";
  files: { name: GameProjectFile; content: string }[];
};
export const GAME_PROJECT_MAX_BYTES = 128 * 1024;

/** Source is untrusted executable code. Validation is not a permission to execute on the host. */
export function validateGameProjectFiles(value: unknown): GameProject["files"] {
  const fail = (): never => {
    throw Error("INVALID_GAME_PROJECT_RESULT");
  };
  if (!Array.isArray(value) || value.length !== 3) return fail();
  let size = 0;
  const names = new Set<string>();
  const files = value.map((file: unknown) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return fail();
    const item = file as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(",") !== "content,name" ||
      typeof item.name !== "string" ||
      !GAME_PROJECT_FILES.includes(item.name as GameProjectFile) ||
      names.has(item.name) ||
      typeof item.content !== "string" ||
      !item.content.trim() ||
      !item.content.isWellFormed() ||
      item.content.includes("\0")
    )
      return fail();
    names.add(item.name);
    const bytes = new TextEncoder().encode(item.content).length;
    size += bytes;
    if (bytes > 64000 || size > GAME_PROJECT_MAX_BYTES) return fail();
    return { name: item.name as GameProjectFile, content: item.content };
  });
  return GAME_PROJECT_FILES.map((name) => files.find((file) => file.name === name)!);
}

export function parseGameProject(source: string): GameProject {
  if (new TextEncoder().encode(source).length > 512 * 1024)
    throw Error("INVALID_GAME_PROJECT_RESULT");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw Error("INVALID_GAME_PROJECT_RESULT");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_GAME_PROJECT_RESULT");
  const item = value as Record<string, unknown>;
  if (
    item.format !== "kosmora.game-project.v1" ||
    Object.keys(item).sort().join(",") !== "files,format"
  )
    throw Error("INVALID_GAME_PROJECT_RESULT");
  return { format: "kosmora.game-project.v1", files: validateGameProjectFiles(item.files) };
}

export const GAME_PROJECT_INSTRUCTION = `Create a complete custom browser game, not a plan or one of three preset engines. Return exactly three files in the normal files envelope: scene.html (static instructions/HUD markup), styles.css, game.js (actual custom game logic). Each file <=64000 UTF-8 bytes; total <=128KiB. No dependencies, assets from URLs, scripts in HTML, imports, DOM access or server. The host supplies a 800x500 canvas, keyboard/pointer input, animation loop and an isolated Web Worker. game.js runs ONCE in the worker after init. It has const game = {canvas:OffscreenCanvas,ctx:CanvasRenderingContext2D,keys:Set<string>,pointer:{x,y,down},onUpdate:null,onKey:null,onPointer:null}. Assign game.onUpdate=(dt)=>{...} (dt in seconds, capped .05); game.onKey=(key,down)=>{...} optional; game.onPointer=(pointer)=>{...} optional. Keys are lower-case event.key, arrow keys e.g. arrowleft and space is ' '. Draw into game.ctx, canvas dimensions game.canvas.width/height. Canvas state, assets generated with drawing primitives, win/lose, scoring and restart controls must be implemented in game.js. Console logs/errors are available for debugging. No window/document/localStorage, network, eval, modules or timers needed. scene.html is static sanitized markup outside the canvas, not interactive UI; style can target #game-stage canvas. Keep code readable and complete, adapt mechanics freely to the requested game. Do not claim deployment, native engine or external asset support.`;
