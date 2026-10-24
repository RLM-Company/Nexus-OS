import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const { fetch, AbortSignal } = globalThis;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const check = (condition, message) => assert.ok(condition, message);

export function options(argv) {
  const result = { check: false, production: false, help: false, apiPort: 3310, webPort: 3300 };
  for (const arg of argv) {
    if (arg === "--check") result.check = true;
    else if (arg === "--production") result.production = true;
    else if (arg === "--help") result.help = true;
    else {
      const port = /^--(api|web)-port=([1-9]\d{0,4})$/.exec(arg);
      if (!port || Number(port[2]) > 65535) throw new Error("Unknown option or invalid port");
      result[port[1] === "api" ? "apiPort" : "webPort"] = Number(port[2]);
    }
  }
  check(result.apiPort !== result.webPort, "API and web ports must be different");
  return result;
}

/** Do not inherit provider credentials, registries, .env loaders or sidecars. */
export function childEnvironment(input, config, directory) {
  const system = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "PATHEXT",
    "LANG",
    "TZ"
  ];
  return {
    ...Object.fromEntries(
      system.filter((key) => input[key] !== undefined).map((key) => [key, input[key]])
    ),
    NODE_ENV: "development",
    API_HOST: "127.0.0.1",
    API_PORT: String(config.apiPort),
    WEB_ORIGIN: `http://127.0.0.1:${config.webPort}`,
    COSMORA_API_ORIGIN: `http://127.0.0.1:${config.apiPort}`,
    DATABASE_URL: `file:${join(directory, "demo.db")}`,
    MODEL_PROVIDER: "mock",
    MODEL_PROVIDER_ID: "mock",
    MODEL_NAME: "manager",
    MODEL_FALLBACK_TO_MOCK: "false",
    MOCK_PROVIDER_MODE: "success",
    KOSMORA_GRAPH_WORKSPACE_ENABLED: "true",
    KOSMORA_MEDIA_DIR: join(directory, "media"),
    KOSMORA_MEDIA_PAID_ENABLED: "false",
    LOG_LEVEL: "error",
    NEXT_TELEMETRY_DISABLED: "1"
  };
}

/** Every displayed relationship has a literal excerpt from this checkout. */
export function sourceGraph(read = (path) => readFileSync(join(root, path), "utf8")) {
  const definitions = [
    {
      path: "apps/web/UI_RULES.md",
      quote:
        "Сайдбар, компоновка и начальный экран чата меняются **только по точечному запросу владельца**.",
      title: "Границы интерфейса",
      claim: "Интерфейс меняется по явному запросу",
      detail: "Для основной оболочки проекта сохранены явные границы изменений."
    },
    {
      path: "packages/core/src/intelligence-graph-context.ts",
      quote: "новые правки графа не обновляют этот снимок.",
      title: "Снимок контекста",
      claim: "Контекст привязан к ревизии графа",
      detail:
        "Снимок контекста сохраняет выбранную ревизию; новую версию нужно просмотреть отдельно."
    },
    {
      path: "apps/api/src/intelligence-graph-context-routes.ts",
      quote: "reviewed: Type.Literal(true)",
      title: "Просмотр перед сохранением",
      claim: "Сохранение контекста требует просмотра",
      detail:
        "API контекста требует reviewed=true и сверяет хеш снимка и версию материалов проекта."
    }
  ];
  const nodes = [
    {
      key: "goal",
      kind: "Goal",
      label: "Показать работу контекста проекта",
      detail: "Демонстрационный маршрут: источник → связь → снимок → сохранение → новая ревизия."
    }
  ];
  const edges = [];
  for (const [i, item] of definitions.entries()) {
    const text = read(item.path);
    const offset = text.indexOf(item.quote);
    check(offset >= 0, `Demo excerpt no longer matches ${item.path}; update it before showing`);
    const line = text.slice(0, offset).split("\n").length;
    const source = `source-${i}`,
      claim = `claim-${i}`;
    nodes.push({
      key: source,
      kind: "Source",
      label: item.title,
      detail: `${item.path}\nSHA-256: ${hash(text)}\n${item.quote}`
    });
    nodes.push({ key: claim, kind: "Claim", label: item.claim, detail: item.detail });
    edges.push({
      relation: "SUPPORTS",
      from: source,
      to: claim,
      evidence: { source, location: `${item.path}:${line}`, excerpt: item.quote }
    });
    edges.push({ relation: "DEPENDS_ON", from: "goal", to: claim });
  }
  return {
    format: "kosmora.intelligence-graph.v1",
    title: "Kosmora · контекст и источники",
    nodes,
    edges
  };
}

export function checkProductionProxy(manifest, apiPort) {
  const rewrites = Array.isArray(manifest.rewrites)
    ? manifest.rewrites
    : Object.values(manifest.rewrites ?? {}).flat();
  check(
    rewrites.some(
      (rule) =>
        rule.source === "/api/:path*" &&
        rule.destination === `http://127.0.0.1:${apiPort}/api/:path*`
    ),
    `The production build uses a different API origin. Use its API port or rebuild with COSMORA_API_ORIGIN=http://127.0.0.1:${apiPort}. Next.js bakes rewrites into the build.`
  );
}

async function available(port) {
  const socket = createServer();
  try {
    await new Promise((done, fail) => {
      socket.once("error", fail);
      socket.listen(port, "127.0.0.1", done);
    });
  } catch {
    throw new Error(`Port ${port} is occupied; this launcher never attaches to another server`);
  }
  await new Promise((done) => socket.close(done));
}

async function stop(record) {
  const child = record?.child;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  record.expectedStop = true;
  const exited = once(child, "exit").catch(() => {});
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const config = options(argv);
  if (config.help) {
    console.log(
      "node scripts/presentation-demo.mjs [--check] [--production] [--api-port=3310] [--web-port=3300]"
    );
    console.log(
      "Local mock demo only. --check uses a new temporary database and stops after HTTP rehearsal."
    );
    return;
  }
  check(Number(process.versions.node.split(".")[0]) >= 24, "Node.js 24+ is required");
  const apiRequire = createRequire(join(root, "apps/api/package.json"));
  apiRequire.resolve("tsx");
  const webRequire = createRequire(join(root, "apps/web/package.json"));
  const next = webRequire.resolve("next/dist/bin/next");
  if (config.production)
    check(
      existsSync(join(root, "apps/web/.next/BUILD_ID")),
      "Build the web app first (pnpm --filter @cosmora/web build)"
    );
  if (config.production)
    checkProductionProxy(
      JSON.parse(readFileSync(join(root, "apps/web/.next/routes-manifest.json"), "utf8")),
      config.apiPort
    );
  await available(config.apiPort);
  await available(config.webPort);
  const directory = config.check
    ? mkdtempSync(join(tmpdir(), "kosmora-presentation-"))
    : join(root, ".tmp/presentation-demo");
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, "launcher.lock");
  let lockFd;
  try {
    lockFd = openSync(lock, "wx");
  } catch {
    throw new Error(
      `Demo lock exists: ${lock}. Stop its launcher first. After a crash remove only that lock, never the database.`
    );
  }
  writeFileSync(lockFd, String(process.pid));
  closeSync(lockFd);
  const env = childEnvironment(process.env, config, directory);
  const children = [];
  let shuttingDown = false;
  let completed = false;
  let cleanupPromise;
  let interrupt;
  const interrupted = new Promise((done) => {
    interrupt = done;
  });
  const cleanup = () => {
    if (!cleanupPromise) {
      shuttingDown = true;
      cleanupPromise = Promise.all(children.map(stop));
    }
    return cleanupPromise;
  };
  const onSignal = () => {
    interrupt();
    void cleanup();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const launch = (name, args, cwd, environment = env, monitor = true) => {
    check(!shuttingDown, "Demo interrupted");
    const log = openSync(join(directory, `${name}.log`), "a");
    const child = spawn(process.execPath, args, {
      cwd,
      env: environment,
      stdio: ["ignore", log, log],
      windowsHide: true
    });
    closeSync(log);
    const record = { name, child, error: null, expectedStop: false };
    child.once("error", (error) => {
      record.error = error;
    });
    child.once("exit", () => {
      if (monitor && !shuttingDown && !record.expectedStop) interrupt();
    });
    children.push(record);
    return record;
  };
  const running = (record) => {
    check(!shuttingDown, "Demo interrupted");
    check(
      !record.error && record.child.exitCode === null && record.child.signalCode === null,
      `${record.name} stopped; inspect ${join(directory, `${record.name}.log`)}`
    );
  };
  const api = `http://127.0.0.1:${config.apiPort}`,
    web = `http://127.0.0.1:${config.webPort}`;
  const response = async (origin, path, method = "GET", body) =>
    fetch(new URL(path, origin), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    });
  const json = async (path, method = "GET", body, origin = api) => {
    const result = await response(origin, path, method, body);
    check(result.ok, `${method} ${path} returned HTTP ${result.status}`);
    return result.json();
  };
  const ready = async (origin, record) => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      running(record);
      try {
        const health = await json("/api/v1/health", "GET", undefined, origin);
        if (health.status === "ok" && health.database === "ok") return;
      } catch {
        /* A started child may still be migrating/compiling. */
      }
      await delay(300);
    }
    throw new Error(`${record.name} did not become ready; inspect ${directory}`);
  };
  const launchApi = () =>
    launch(
      "api",
      [
        "--require",
        join(root, "scripts/windows-node-user.cjs"),
        "--import",
        "tsx",
        "--conditions=development",
        "src/server.ts"
      ],
      join(root, "apps/api")
    );
  try {
    console.log("Запуск локальной репетиции Kosmora. Модель: mock; внешние вызовы отключены.");
    let apiProcess = launchApi();
    await ready(api, apiProcess);
    const runtime = await json("/api/v1/model-runtime");
    check(
      runtime.mode === "mock" &&
        runtime.provider === "mock" &&
        runtime.credential_configured === false,
      "Mock-only runtime verification failed"
    );
    const worker = join(root, "apps/web/scripts/prepare-pdf-worker.mjs");
    const prepared = launch("pdf-worker", [worker], join(root, "apps/web"), env, false);
    // A short preparation process is expected to exit successfully.
    await once(prepared.child, "exit");
    check(prepared.child.exitCode === 0, "PDF worker preparation failed");
    const webProcess = launch(
      "web",
      [
        next,
        config.production ? "start" : "dev",
        ...(config.production ? [] : ["--webpack"]),
        "-H",
        "127.0.0.1",
        "-p",
        String(config.webPort)
      ],
      join(root, "apps/web"),
      { ...env, NODE_ENV: config.production ? "production" : "development" }
    );
    await ready(web, webProcess);
    const proxiedRuntime = await json("/api/v1/model-runtime", "GET", undefined, web);
    check(
      proxiedRuntime.mode === "mock" && proxiedRuntime.credential_configured === false,
      "Web proxy is connected to another runtime"
    );
    const manifestPath = join(directory, "demo.json");
    let state = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    if (!state) {
      const nonce = randomUUID();
      const created = await json("/api/v1/projects", "POST", {
        initial_message: "Локальная репетиция Kosmora: показать сохранение материалов проекта.",
        client_message_id: `presentation-${nonce}`
      });
      const projectId = created.project.id;
      const base = `/api/v1/projects/${encodeURIComponent(projectId)}`;
      let active = false;
      for (let i = 0; i < 100; i++) {
        if ((await json(base)).project.status === "ACTIVE") {
          active = true;
          break;
        }
        await delay(200);
      }
      check(active, "The mock project did not become ACTIVE");
      const materials = await json(base + "/materials");
      await json(base + "/materials", "PUT", {
        version: materials.version,
        instructions:
          "Используй материалы как цитируемые данные. Различай непроверенные утверждения и подтверждённые источники.",
        attachments: [
          {
            name: "demo-notes.md",
            content:
              "# План показа\nИсточники → граф → просмотр снимка → сохранение → новая ревизия.\nМодель в этой локальной репетиции — mock."
          }
        ]
      });
      const portable = sourceGraph();
      const preview = await json(base + "/intelligence-graphs/import/preview", "POST", {
        package: portable
      });
      const graph = await json(base + "/intelligence-graphs/import", "POST", {
        package: portable,
        expected_sha256: preview.sha256,
        creation_key: `presentation_${nonce.replaceAll("-", "")}`
      });
      state = { version: 1, projectId, graphId: graph.graph_id };
      writeFileSync(manifestPath, JSON.stringify(state, null, 2) + "\n");
    }
    check(
      state.version === 1 &&
        typeof state.projectId === "string" &&
        typeof state.graphId === "string",
      "Invalid demo manifest; existing data was not changed"
    );
    const base = `/api/v1/projects/${encodeURIComponent(state.projectId)}`;
    const graphPath = base + `/intelligence-graphs/${encodeURIComponent(state.graphId)}`;
    const graph = await json(graphPath);
    check(
      graph.graph_id === state.graphId && graph.revision >= 1,
      "Saved graph is unavailable; existing data was not overwritten"
    );
    if (config.check)
      check(
        graph.nodes.length === 7 && graph.edges.length === 6,
        "Fresh demo graph content differs"
      );
    const page = await response(
      web,
      `/graph-workspace?projectId=${encodeURIComponent(state.projectId)}`
    );
    check(
      page.ok && (page.headers.get("content-type") ?? "").includes("text/html"),
      "Graph workspace did not render HTML"
    );
    if (config.check) {
      const contextPath = graphPath + "/context";
      const before = await json(base + "/materials");
      const preview = await json(contextPath + `?q=контекст&revision=${graph.revision}`);
      check(
        hash(
          JSON.stringify([
            preview.attachment.name,
            preview.attachment.content,
            preview.attachment.source_type ?? null
          ])
        ) === preview.sha256,
        "Context preview hash mismatch"
      );
      assert.deepEqual(
        await json(base + "/materials"),
        before,
        "Preview changed project materials"
      );
      await json(contextPath, "PUT", {
        q: "контекст",
        revision: graph.revision,
        expected_sha256: preview.sha256,
        expected_materials_version: before.version,
        reviewed: true
      });
      const saved = await json(base + "/materials");
      check(
        (await json(contextPath + "/status")).status === "current",
        "Saved context is not current"
      );
      await stop(apiProcess);
      apiProcess = launchApi();
      await ready(api, apiProcess);
      assert.deepEqual(
        await json(base + "/materials", "GET", undefined, web),
        saved,
        "Materials changed after API restart"
      );
      const changed = await json(graphPath + "/edits", "POST", {
        expected_revision: graph.revision,
        operation: { kind: "rename", title: "Kosmora · новая ревизия контекста" }
      });
      check(
        (await json(contextPath + "/status")).status === "stale",
        "A graph edit did not mark the context stale"
      );
      assert.deepEqual(
        await json(base + "/materials"),
        saved,
        "A graph edit rewrote saved context"
      );
      const updated = await json(contextPath + `?q=контекст&revision=${changed.revision}`);
      const staleWrite = await response(api, contextPath, "PUT", {
        q: "контекст",
        revision: changed.revision,
        expected_sha256: updated.sha256,
        expected_materials_version: before.version,
        reviewed: true
      });
      check(staleWrite.status === 409, "A stale materials version was accepted");
      const applied = await json(contextPath, "PUT", {
        q: "контекст",
        revision: changed.revision,
        expected_sha256: updated.sha256,
        expected_materials_version: saved.version,
        reviewed: true
      });
      check(
        (await json(contextPath + "/status")).status === "current",
        "Updated context is not current"
      );
      await json(contextPath, "DELETE", {
        expected_sha256: updated.sha256,
        expected_materials_version: applied.state.materials_version
      });
      check(
        (await json(contextPath + "/status")).status === "missing",
        "Removed context is still present"
      );
      const retained = await json(base + "/materials");
      assert.deepEqual(
        retained.attachments,
        before.attachments,
        "Removing the snapshot changed other files"
      );
      check(
        retained.instructions === before.instructions,
        "Removing the snapshot changed instructions"
      );
      console.log(
        "HTTP rehearsal PASS: mock runtime, web proxy, graph import/HTML, preview/hash, save, API restart, stale detection, CAS, replace/remove and retained files."
      );
      console.log("Это HTTP-проверка; клики и визуальная браузерная приёмка не проверялись.");
    } else {
      console.log(`Граф: ${web}/graph-workspace?projectId=${encodeURIComponent(state.projectId)}`);
      console.log(`Проект: ${web}/?project=${encodeURIComponent(state.projectId)}`);
      console.log(`Данные и логи: ${directory}`);
      console.log(
        `В графе ${graph.nodes.length} записей и ${graph.edges.length} связей. Источники и статусы видны в записях; демонстрационные данные не повышаются до проверенных фактов.`
      );
      console.log(
        "Запрос контекста: «контекст». Просмотрите снимок и подтвердите сохранение в интерфейсе. Ctrl+C завершает оба сервера."
      );
      await interrupted;
      if (!shuttingDown) {
        running(apiProcess);
        running(webProcess);
      }
    }
    completed = true;
  } finally {
    await cleanup();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    unlinkSync(lock);
    if (config.check && completed) rmSync(directory, { recursive: true, force: true });
    else if (config.check) console.error(`Rehearsal logs retained: ${directory}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Presentation demo FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
