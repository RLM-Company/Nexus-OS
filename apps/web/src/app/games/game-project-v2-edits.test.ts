import { describe, expect, it } from "vitest";
import { parseGameProjectV2 } from "@cosmora/contracts/game-project-v2";
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

  it("edits camera, light and material without touching mesh vertices or the transform marker", () => {
    const first = applyV2FieldEdit(source, {
      field: "model_transform",
      name: "ship.obj",
      value: { rotation: "0.5,1.2", scale: "2" }
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const result = applyV2FieldEdit(first.json, {
      field: "model_render",
      name: "ship.obj",
      value: {
        camera: "1,2,7,60",
        light: "-2,5,4,3",
        color: "#ff8800",
        wireframe: true
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.project.model?.data ?? "";
    expect(data).toContain("v 0 0 0");
    expect(data).toContain("f 1 2 3");
    expect(data).toContain("rotation=0.5,1.2;scale=2");
    const editable = readV2Editable(result.json);
    expect(editable.ok && editable.render).toEqual({
      camera: "1,2,7,60",
      light: "-2,5,4,3",
      color: "#ff8800",
      wireframe: true
    });
  });

  it("refuses an unsafe color and keeps source files byte-identical when changing the launch mode", () => {
    expect(
      applyV2FieldEdit(source, {
        field: "model_render",
        name: "ship.obj",
        value: {
          camera: "0,1,5,50",
          light: "3,4,5,2",
          color: "javascript:alert(1)",
          wireframe: false
        }
      })
    ).toMatchObject({ ok: false, error: "INVALID_COLOR" });
    const result = applyV2FieldEdit(source, {
      field: "launch",
      value: { runtime: "canvas2d_worker", auto_start: true }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.launch).toEqual({ runtime: "canvas2d_worker", auto_start: true });
    expect(result.project.files).toEqual(parseGameProjectV2(source).files);
  });

  it("adds and removes a linked game asset without touching scenes or sources", () => {
    const added = applyV2FieldEdit(source, {
      field: "asset_add",
      value: { name: "hud.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.project.assets.map((asset) => asset.name)).toEqual(["logo.png", "hud.png"]);
    expect(added.project.scenes).toEqual(parseGameProjectV2(source).scenes);
    expect(added.project.files).toEqual(parseGameProjectV2(source).files);
    const existing = added.project.assets[0];
    if (!existing) throw Error("ASSET_MISSING");
    expect(applyV2FieldEdit(added.json, { field: "asset_add", value: existing })).toMatchObject({
      ok: false,
      error: "ASSET_EXISTS"
    });
    const removed = applyV2FieldEdit(added.json, { field: "asset_remove", name: "hud.png" });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.project.assets).toEqual(parseGameProjectV2(source).assets);
    const reopened = readV2Editable(removed.json);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.assets).toEqual(parseGameProjectV2(source).assets);
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
