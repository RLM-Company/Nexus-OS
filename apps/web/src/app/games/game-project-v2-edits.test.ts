import { describe, expect, it } from "vitest";
import { applyV2FieldEdit, readV2Editable } from "./game-project-v2-edits";

const source = JSON.stringify({
  format: "kosmora.game-project.v2",
  title: "Космический курьер",
  files: {
    scene_html: "<h1>Старт</h1>",
    styles_css: "body{color:white}",
    game_js: "game.onUpdate = (dt) => {};"
  },
  launch: { runtime: "web3d_sandbox", auto_start: false },
  assets: [{ name: "logo.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }],
  scenes: [{ id: "level-1", title: "Уровень 1", html: "<p>Первый</p>" }],
  model: {
    name: "ship.obj",
    format: "obj-lite",
    data: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3"
  }
});

describe("addressable v2 project edits", () => {
  it("changes only the selected scene and preserves other scenes, assets and sources", () => {
    const result = applyV2FieldEdit(source, {
      field: "scene",
      id: "level-1",
      value: { title: "Уровень 1 — новая цель", html: "<p>Второй</p>" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.scenes).toEqual([
      { id: "level-1", title: "Уровень 1 — новая цель", html: "<p>Второй</p>" }
    ]);
    expect(result.project.assets[0]?.name).toBe("logo.png");
    expect(result.project.files.game_js).toBe("game.onUpdate = (dt) => {};");
    expect(result.project.title).toBe("Космический курьер");
  });

  it("edits the model transform without touching the original mesh vertices", () => {
    const result = applyV2FieldEdit(source, {
      field: "model_transform",
      name: "ship.obj",
      value: { rotation: "0.5,1.2", scale: "2" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.model?.data).toContain("v 0 0 0");
    expect(result.project.model?.data).toContain("f 1 2 3");
    const editable = readV2Editable(result.json);
    expect(editable.ok && editable.transform).toEqual({ rotation: "0.5,1.2", scale: "2" });
  });

  it("keeps source files byte-identical when changing the launch mode", () => {
    const result = applyV2FieldEdit(source, {
      field: "launch",
      value: { runtime: "canvas2d_worker", auto_start: true }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.launch).toEqual({ runtime: "canvas2d_worker", auto_start: true });
    expect(result.project.files).toEqual(JSON.parse(source).files);
  });

  it("refuses an unknown scene and an invalid result without overwriting", () => {
    expect(
      applyV2FieldEdit(source, { field: "scene", id: "missing", value: { title: "x", html: "y" } })
    ).toMatchObject({
      ok: false,
      error: "SCENE_NOT_FOUND"
    });
    const tooLong = "x".repeat(70000);
    expect(applyV2FieldEdit(source, { field: "scene_html", value: tooLong })).toMatchObject({
      ok: false,
      error: "RESULT_INVALID"
    });
    expect(readV2Editable("{}")).toMatchObject({ ok: false, error: "INVALID_GAME_PROJECT_V2" });
  });
});
