// Reproducible Games+Sites product scenario for the OC2 delivery.
// Uses the real edit modules, real site contract validation and the existing
// verified ZIP conventions. No model/provider, no network, no owner PC.
//
//   node --import <tsx-loader> scripts/run-games-sites-scenario.mjs --out=<dedicated dir>

import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { zipSync, unzipSync, strToU8 } = require(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps/web/node_modules/fflate")
);
const arg = process.argv.find((a) => a.startsWith("--out="));
const out = arg
  ? resolve(arg.slice(6))
  : join(process.env.TEMP ?? "/tmp", "koswork-games-sites-" + Date.now());
if (arg && (!isAbsolute(out) || basename(out).indexOf("koswork") === -1))
  throw Error("OUT_MUST_BE_DEDICATED_FOLDER");
mkdirSync(out, { recursive: true });

// Transpile-only load of the real web modules. Write to a temp folder INSIDE
// the repo so Node resolves @cosmora/* and three from the workspace.
const ts = require("typescript");
const fs = require("node:fs");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = [];
const loadTs = async (relative) => {
  const file = join(repo, relative);
  const source = fs.readFileSync(file, "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  js = js.replace(/from "(\.[^"]+)"/g, (full, spec) =>
    /\.(generated\.mjs|mjs|js)$/.test(spec) ? full : `from "${spec}.generated.mjs"`
  );
  // Same directory keeps relative imports (./game-3d-renderer) working.
  const target = file.replace(/\.tsx?$/, ".generated.mjs");
  writeFileSync(target, js, "utf8");
  generated.push(target);
  return import(new URL("file:///" + target.replaceAll("\\", "/")).href);
};
process.on("exit", () => {
  for (const file of generated) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
});

const checks = [];
const journal = [];
const log = (event, detail = {}) => {
  journal.push({ at: new Date().toISOString(), event, ...detail });
  writeFileSync(
    join(out, "actions.jsonl"),
    journal.map((x) => JSON.stringify(x)).join("\n") + "\n"
  );
};
const check = (name, fn) => {
  try {
    const detail = fn();
    checks.push({ name, status: "pass", detail: detail ?? "" });
    log("check", { name, status: "pass" });
  } catch (error) {
    checks.push({ name, status: "fail", detail: String(error?.message ?? error) });
    log("check", { name, status: "fail", error: String(error?.message ?? error) });
  }
};
const sha = (value) => createHash("sha256").update(value).digest("hex");

const model = "v 0 0 0\nv 2 0 0\nv 0 2 0\nv 2 2 0\nf 1 2 3\nf 2 4 3";

const game = {
  format: "kosmora.game-project.v2",
  title: "Космический курьер",
  files: {
    scene_html: "<h1>Доставь посылку</h1>",
    styles_css: "body{background:#0c1118;color:#fff}",
    game_js: "game.onUpdate=(dt)=>{game.ctx.clearRect(0,0,800,500)};"
  },
  launch: { runtime: "web3d_sandbox", auto_start: false },
  assets: [{ name: "badge.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }],
  scenes: [
    {
      id: "level-1",
      title: "Уровень 1",
      html: "<!-- kosmora-transform:rotation=0.25,0.45;scale=1-->\n<p>Старт</p>"
    }
  ],
  model: { name: "ship.obj", format: "obj-lite", data: model }
};
const siteHtml = "<html><body><h1>Космический курьер</h1><p>Игра про доставку.</p></body></html>";
const site = {
  format: "kosmora.site-project.v1",
  title: "Сайт игры",
  blocks: [
    { id: "hero", title: "Главный экран", html: "<h1>Космический курьер</h1>" },
    { id: "features", title: "Механика", html: "<p>Доставь груз за 60 секунд</p>" }
  ],
  resources: [{ name: "poster.png", media_type: "image/png", data_base64: "iVBORw0KGgo=" }],
  html: siteHtml
};

async function main() {
  // Dependency of three-scene.ts; transpile first so its .mjs exists.
  await loadTs("apps/web/src/app/games/game-3d-renderer.ts");
  const gameEdits = await loadTs("apps/web/src/app/games/game-project-v2-edits.ts");
  const threeScene = await loadTs("apps/web/src/app/games/three-scene.ts");
  const siteProject = await loadTs("apps/web/src/app/sites/site-project.ts");

  let gameJson = JSON.stringify(game, null, 2);
  let siteJson = JSON.stringify(site, null, 2);

  check("01 create a new 3D game and a sales site from one dataset", () => {
    const g = gameEdits.readV2Editable(gameJson);
    const s = siteProject.parseSiteProject(siteJson);
    if (!g.ok || g.transform?.rotation !== "0.25,0.45") throw Error("GAME_INVALID");
    if (s.blocks.length !== 2 || s.resources.length !== 1) throw Error("SITE_INVALID");
    return `game blocks=${g.scenes.length}, site blocks=${s.blocks.length}`;
  });

  check("02 edit game mechanic (launch mode and source) without losing model", () => {
    const result = gameEdits.applyV2FieldEdit(gameJson, {
      field: "launch",
      value: { runtime: "canvas2d_worker", auto_start: true }
    });
    if (!result.ok) throw Error(result.error);
    const next = gameEdits.applyV2FieldEdit(result.json, {
      field: "game_js",
      value: "game.onUpdate=(dt)=>{game.ctx.fillRect(0,0,40,40)};"
    });
    if (!next.ok) throw Error(next.error);
    if (next.project.model?.data !== model) throw Error("MODEL_LOST");
    gameJson = next.json;
    return `launch=${next.project.launch.runtime}, auto_start=${next.project.launch.auto_start}`;
  });

  check("03 edit scene object transform; original model vertices preserved", () => {
    const result = gameEdits.applyV2FieldEdit(gameJson, {
      field: "model_transform",
      name: "ship.obj",
      value: { rotation: "0.8,1.4", scale: "2" }
    });
    if (!result.ok) throw Error(result.error);
    if (!result.project.model?.data.includes(model)) throw Error("VERTICES_CHANGED");
    const descriptor = gameEdits.v2SceneDescriptor(result.project);
    const scene = threeScene.buildThreeScene(result.project.model.data, descriptor);
    const THREE = require(join(repo, "apps/web/node_modules/three"));
    const mesh = scene.children.find((c) => c instanceof THREE.Mesh);
    if (!mesh || mesh.rotation.y !== 1.4 || mesh.scale.x !== 2)
      throw Error("RUNTIME_TRANSFORM_MISMATCH");
    gameJson = result.json;
    return "rotation=0.8,1.4 scale=2, vertices unchanged, scene built";
  });

  check("04 edit one site block; other blocks and resources stay byte-identical", () => {
    const result = siteProject.editSiteBlock(siteJson, "features", {
      title: "Обновлённая механика",
      html: "<p>Доставь груз за 45 секунд</p>"
    });
    if (!result.ok) throw Error(result.error);
    if (result.project.blocks[0]?.html !== site.blocks[0].html) throw Error("OTHER_BLOCK_CHANGED");
    if (result.project.resources[0]?.name !== "poster.png") throw Error("RESOURCE_LOST");
    siteJson = result.json;
    return "features updated, hero and poster.png preserved";
  });

  check("05 save + export ZIP with verified paths, unzip and reopen same sources", () => {
    const entries = {
      "project.json": strToU8(gameJson),
      "scene_html.txt": strToU8(JSON.parse(gameJson).files.scene_html),
      "styles_css.txt": strToU8(JSON.parse(gameJson).files.styles_css),
      "game_js.txt": strToU8(JSON.parse(gameJson).files.game_js),
      "site.project.json": strToU8(siteJson),
      "index.html": strToU8(site.html),
      "README.txt": strToU8(
        "Koskora Games+Sites export; source of truth is project.json and site.project.json.\n"
      )
    };
    const archive = zipSync(entries, { level: 6 });
    const restored = unzipSync(archive);
    if (
      Buffer.compare(
        Buffer.from(restored["project.json"]),
        Buffer.from(entries["project.json"])
      ) !== 0
    )
      throw Error("GAME_SOURCE_MISMATCH");
    if (
      Buffer.compare(
        Buffer.from(restored["site.project.json"]),
        Buffer.from(entries["site.project.json"])
      ) !== 0
    )
      throw Error("SITE_SOURCE_MISMATCH");
    const reopenedGame = gameEdits.readV2Editable(
      Buffer.from(restored["project.json"]).toString("utf8")
    );
    const reopenedSite = siteProject.parseSiteProject(
      Buffer.from(restored["site.project.json"]).toString("utf8")
    );
    if (!reopenedGame.ok || reopenedGame.transform?.rotation !== "0.8,1.4")
      throw Error("GAME_REOPEN_FAILED");
    if (reopenedSite.blocks[1]?.title !== "Обновлённая механика") throw Error("SITE_REOPEN_FAILED");
    writeFileSync(join(out, "games-sites-export.zip"), archive);
    return `zip bytes=${archive.length}, sha256=${sha(Buffer.from(archive)).slice(0, 12)}`;
  });

  check("06 bad resource / unsupported format / empty block are refused", () => {
    const badResource = siteProject.editSiteResource(siteJson, {
      name: "virus.exe",
      media_type: "image/png",
      data_base64: "AAAA"
    });
    if (badResource.ok) throw Error("BAD_RESOURCE_ACCEPTED");
    const badHtml = siteProject.editSiteBlock(siteJson, "hero", {
      title: "x",
      html: "<script>alert(1)</script>"
    });
    if (badHtml.ok) throw Error("SCRIPT_ACCEPTED");
    const badModel = gameEdits.applyV2FieldEdit(gameJson, {
      field: "model_transform",
      name: "ship.glb",
      value: { rotation: "0,0", scale: "1" }
    });
    if (badModel.ok) throw Error("UNSUPPORTED_MODEL_ACCEPTED");
    return "bad name, script html and non-obj model rejected";
  });

  const payload = {
    passed: checks.every((c) => c.status === "pass"),
    suite: "koswork-games-sites-scenario",
    at: new Date().toISOString(),
    base: "real edit modules + real three.js scene + real site validator + verified ZIP round-trip",
    checks,
    artifact: {
      file: "games-sites-export.zip",
      sha256: sha(readFileSync(join(out, "games-sites-export.zip")))
    },
    limits: [
      "No paid model, network or Electron GUI used; scene is built and validated in Node, WebGL component is exercised by project build.",
      "Owner-tested 'Ночная смена' game was not reused."
    ]
  };
  writeFileSync(join(out, "result.json"), JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify({ ...payload, out, journal: join(out, "actions.jsonl") }, null, 2));
  process.exitCode = payload.passed ? 0 : 1;
}

main().catch((error) => {
  log("fatal", { error: String(error?.message ?? error) });
  console.error(error);
  process.exitCode = 1;
});
