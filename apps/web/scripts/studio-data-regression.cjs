// Run directly: node apps/web/scripts/studio-data-regression.cjs
/* eslint @typescript-eslint/no-require-imports: "off" */
/* global require, __dirname, console, process, Buffer, AbortController, setTimeout, clearTimeout */
// No server, paid API, browser, or fixture data: compiles actual TypeScript to a temp folder.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const source = path.resolve(__dirname, "../src/app");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-data-regression-"));
process.on("exit", () => fs.rmSync(output, { recursive: true, force: true }));
const names = [
  "studio-csv.ts",
  "studio-data-core.ts",
  "studio-data-export.ts",
  "studio-data-worker.ts"
];
const root = path.resolve(__dirname, "../../..");
const contract = path.join(root, "packages/contracts/src/data-workspace.ts");
const config = path.join(output, "tsconfig.json");
fs.writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "commonjs",
      moduleResolution: "node",
      ignoreDeprecations: "6.0",
      lib: ["es2022", "dom", "webworker"],
      skipLibCheck: true,
      rootDir: root,
      outDir: output,
      paths: { "@cosmora/contracts/data-workspace": [contract] }
    },
    files: [...names.map((name) => path.join(source, name)), contract]
  })
);
const argumentsForTsc = ["--project", config];
let compiler;
try {
  compiler = require.resolve("typescript/bin/tsc", { paths: [__dirname] });
} catch {
  compiler = null;
}
const built = compiler
  ? spawnSync(process.execPath, [compiler, ...argumentsForTsc], { encoding: "utf8" })
  : spawnSync("tsc", argumentsForTsc, { encoding: "utf8" });
if (built.error || built.status !== 0) {
  console.error(built.stderr || built.stdout || built.error || "No TypeScript compiler in PATH");
  process.exit(1);
}
// The same shared validator is compiled from source; no installed/dist copy or
// duplicate test-only schema is substituted for the real implementation.
const contractOutput = path.join(output, "node_modules/@cosmora/contracts");
fs.mkdirSync(contractOutput, { recursive: true });
fs.writeFileSync(
  path.join(contractOutput, "package.json"),
  JSON.stringify({ exports: { "./data-workspace": "./data-workspace.js" } })
);
fs.copyFileSync(
  path.join(output, "packages/contracts/src/data-workspace.js"),
  path.join(contractOutput, "data-workspace.js")
);
const appOutput = path.join(output, "apps/web/src/app");
const C = require(path.join(appOutput, "studio-data-core.js"));
const E = require(path.join(appOutput, "studio-data-export.js"));
let cases = 0;
async function check(name, fn) {
  await fn();
  console.log(`PASS ${++cases}: ${name}`);
}
function newWorker() {
  const entry = path.join(appOutput, "studio-data-worker.js");
  return new Worker(
    `const { parentPort } = require('node:worker_threads');\n` +
      `global.self = { postMessage: (v) => parentPort.postMessage(v) };\n` +
      `require(${JSON.stringify(entry)});\n` +
      `parentPort.on('message', data => self.onmessage({ data }));`,
    { eval: true }
  );
}
function utf8Buffer(value) {
  const b = Buffer.from(value, "utf8");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
(async () => {
  await check("strict Russian decimals, ID preserve, duplicates and quoted CRLF", async () => {
    const tab = await C.loadDataCsv(
      '\ufeffid;amt;amt\r\nID001;"1\u202f234,50";5\r\n001;"4\r\n5";9\r\n'
    );
    assert.deepEqual(tab.headers, ["id", "amt", "amt"]);
    assert.equal(tab.rows[1][1], "4\r\n5");
    assert.equal(C.dataNumber("1\u202f234,50"), 1234.5);
    assert.equal(C.dataNumber("1,234.50"), null);
    assert.equal(C.dataNumber("9007199254740993"), null);
    const settings = C.initialDataSettings(tab);
    settings.types[1] = "number";
    settings.measure = 1;
    assert.equal(C.queryData(tab, settings).stats.count, 1);
  });
  await check(
    "large 80,000x10 CSV (800K cells), cross-quoted fields, no silent row trim",
    async () => {
      const header = Array.from({ length: 10 }, (_, i) => `c${i}`).join("\t");
      const row = 'ID001\t"text\nline"\t1,5\t2\t3\t4\t5\t6\t7\t8\n';
      const src = header + "\n" + row.repeat(80000);
      assert.ok(Buffer.byteLength(src) < C.DATA_LIMITS.csvBytes);
      const pf = await C.preflightDataCsv(src);
      assert.equal(pf.rows, 80001);
      assert.equal(pf.width, 10);
      assert.equal(pf.delimiter, "\t");
      const tab = await C.loadDataCsv(src);
      assert.equal(tab.rows.length, 80000);
      assert.equal(tab.rows[79999][1], "text\nline");
    }
  );
  await check("hard UTF-8 byte/rows/columns/cells, malformed quotes", async () => {
    await assert.rejects(C.preflightDataCsv("😀".repeat(2_000_001)), /8 МБ/);
    await assert.rejects(C.preflightDataCsv("a\tb\n" + "a\tb\n".repeat(80001)), /80 000/);
    await assert.rejects(C.preflightDataCsv("x,".repeat(100) + "z\nA"), /100 столбцов/);
    await assert.rejects(
      C.preflightDataCsv("x,".repeat(19) + "y\n" + "a\n".repeat(55_000)),
      /1 млн ячеек/
    );
    await assert.rejects(C.loadDataCsv('id,name\n1,"unterminated'), /кав|разделит|CSV/i);
  });
  await check(
    "workspace rejects invalid schema/types/columns/row shape, exact dup headers",
    async () => {
      const tab = await C.loadDataCsv("x,x,y\n1,2,3\n4,5,6");
      const cfg = C.initialDataSettings(tab);
      const file = await E.exportWorkspace("dup", tab, cfg, new AbortController().signal);
      const reopened = C.parseDataWorkspace(await file.text());
      assert.deepEqual(reopened.table.headers, ["x", "x", "y"]);
      assert.deepEqual(reopened.table.rows, tab.rows);
      const json = JSON.parse(await file.text());
      json.settings.columns = [1, 1];
      assert.throws(() => C.parseDataWorkspace(JSON.stringify(json)), /колонок/);
      json.settings.columns = [0, 1, 2];
      json.settings.types = ["number", "text", "garbage"];
      assert.throws(() => C.parseDataWorkspace(JSON.stringify(json)), /колонок/);
      json.settings.types = ["text", "text", "text"];
      json.table.rows[0] = [1, 2, 3];
      assert.throws(() => C.parseDataWorkspace(JSON.stringify(json)), /строка/);
    }
  );
  await check(
    "scatter numeric axes, missing/invalid counts, stable X sort and SVG extreme finite",
    async () => {
      const table = await C.loadDataCsv("x,y\n5,20\n1,10\n1,15\nBAD,8\n,4\n-2,-9");
      const cfg = C.initialDataSettings(table);
      cfg.types = ["number", "number"];
      cfg.measure = 1;
      cfg.chart = { kind: "scatter", x: 0, y: 1 };
      const r = C.queryData(table, cfg);
      assert.equal(r.plot.valid, 4);
      assert.equal(r.plot.missing, 1);
      assert.equal(r.plot.invalid, 1);
      assert.equal(
        (E.dataSvg(r.plot.points, "scat", "X", "Y", "scatter").match(/<circle/g) || []).length,
        4
      );
      cfg.chart.kind = "line";
      assert.deepEqual(
        C.queryData(table, cfg).plot.points.map((p) => p.x),
        [-2, 1, 1, 5]
      );
      const huge = E.dataSvg(
        [
          { x: -1e308, y: -1e308, row: 0 },
          { x: 1e308, y: 1e308, row: 1 }
        ],
        "<script>",
        "X",
        "Y",
        "scatter"
      );
      assert.ok(!huge.includes("NaN") && !huge.includes("Infinity") && !huge.includes("<script>"));
    }
  );
  await check(
    "CSV spreadsheet injection including invisible prefixes; JSON duplicate headers",
    async () => {
      for (const raw of [
        "=SUM(1)",
        " \t@bad",
        "\u200f=1",
        "\u202e+1",
        "\u2063－1",
        "\ufeff=1",
        "\u0000@bad"
      ])
        assert.equal(E.safeSpreadsheetCell(raw), "'" + raw);
      const t = await C.loadDataCsv('x,x\nA," \t=SUM(1)"\nB,"\u200f@1"');
      const s = C.initialDataSettings(t);
      const csv = await (
        await E.exportData(t, [0, 1], s, "csv", new AbortController().signal)
      ).text();
      assert.ok(csv.includes("' \t=SUM(1)") && csv.includes("'\u200f@1"));
      const json = JSON.parse(
        await (await E.exportData(t, [0, 1], s, "json", new AbortController().signal)).text()
      );
      assert.deepEqual(
        json.columns.map((c) => c.name),
        ["x", "x"]
      );
      assert.deepEqual(json.rows, t.rows);
    }
  );
  await check(
    "large JSON export overflow aborts explicitly, CSV full export and bounded attachment rows",
    async () => {
      const big = { delimiter: ",", headers: ["x"], rows: [["\u0000".repeat(6_000_000)]] };
      const s = C.initialDataSettings(big);
      await assert.rejects(
        E.exportData(big, [0], s, "json", new AbortController().signal),
        /32 МБ/
      );
      const t = await C.loadDataCsv("id,val\n" + '😀,"quoted\nline"\n'.repeat(300));
      const st = C.initialDataSettings(t);
      const ids = C.queryData(t, st).indexes;
      const blob = await E.exportData(t, ids, st, "csv", new AbortController().signal);
      assert.equal((await blob.text()).split("😀").length - 1, 300);
      const a = E.attachmentData(t, ids, st.columns, 100, 200);
      assert.equal(a.truncated, true);
      assert.ok(a.includedRows > 0);
      assert.ok(Buffer.byteLength(a.content) <= 100);
      const parsed = await C.loadDataCsv(a.content);
      assert.equal(parsed.rows.length, a.includedRows);
    }
  );
  await check("export/workspace cancellation mid-batch", async () => {
    const t = await C.loadDataCsv("x,y\n" + "1,2\n".repeat(2000));
    const s = C.initialDataSettings(t);
    const rows = C.queryData(t, s).indexes;
    const ac = new AbortController();
    await assert.rejects(
      E.exportData(t, rows, s, "csv", ac.signal, (n) => {
        if (n === 512) ac.abort();
      }),
      { name: "AbortError" }
    );
    const bc = new AbortController();
    await assert.rejects(
      E.exportWorkspace("cancel", t, s, bc.signal, (n) => {
        if (n === 512) bc.abort();
      }),
      { name: "AbortError" }
    );
  });
  await check("REAL worker parse, filter, numeric scatter response", async () => {
    const worker = newWorker();
    const out = [];
    try {
      worker.on("message", (v) => out.push(v));
      worker.postMessage({
        id: 1,
        kind: "csv",
        buffer: utf8Buffer("x,y\n3,9\n1,7\n2,5"),
        name: "table.csv"
      });
      const loaded = await new Promise((res, rej) => {
        const deadline = setTimeout(() => rej(Error("worker load timeout")), 10000);
        const h = (v) => {
          if (v.id === 1 && (v.kind === "loaded" || v.kind === "error")) {
            clearTimeout(deadline);
            worker.off("message", h);
            res(v);
          }
        };
        worker.on("message", h);
      });
      assert.equal(loaded.kind, "loaded");
      assert.equal(loaded.table.rows.length, 3);
      const settings = loaded.settings;
      settings.types = ["number", "number"];
      settings.chart = { kind: "scatter", x: 0, y: 1 };
      worker.postMessage({ id: 2, kind: "query", settings });
      const answer = await new Promise((res, rej) => {
        const deadline = setTimeout(() => rej(Error("worker query timeout")), 10000);
        const h = (v) => {
          if (v.id === 2) {
            clearTimeout(deadline);
            worker.off("message", h);
            res(v);
          }
        };
        worker.on("message", h);
      });
      assert.equal(answer.kind, "result");
      assert.equal(answer.result.plot.valid, 3);
    } finally {
      await worker.terminate();
    }
  });
  await check("REAL worker termination during 80k-row parse (no late loaded message)", async () => {
    const worker = newWorker();
    const observed = [];
    const data = "a,b,c,d,e,f,g,h,i,j\n" + "a,b,c,d,e,f,g,h,i,j\n".repeat(80000);
    worker.on("message", (v) => observed.push(v));
    worker.postMessage({ id: 3, kind: "csv", buffer: utf8Buffer(data), name: "big.csv" });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("no worker progress while parsing")), 10000);
      const listener = (v) => {
        if (v.id === 3 && (v.kind === "progress" || v.kind === "loaded")) {
          clearTimeout(timer);
          worker.off("message", listener);
          resolve();
        }
      };
      worker.on("message", listener);
    });
    await worker.terminate();
    const after = observed.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(observed.length, after);
    assert.equal(
      observed.some((x) => x.kind === "loaded"),
      false,
      "terminated before completion"
    );
  });
  console.log(`TOTAL ${cases}/${cases} PASS`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
