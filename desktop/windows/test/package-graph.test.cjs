"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPackageGraphReport } = require("../ci/check-package-graph.cjs");

test("граф пакета полный: каждый достижимый require внутри build.files", () => {
  const report = buildPackageGraphReport();
  assert.ok(report.walked > 40, `ожидался реальный граф, а не ${report.walked} файлов`);
  assert.deepEqual(
    report.missing.map(({ file, why }) => `${file}: ${why}`),
    [],
    "упакованный EXE обязан находить все свои модули"
  );
});

test("новые модули включены в пакет явно, а не wildcard'ом", () => {
  const files = require("../package.json").build.files;
  for (const entry of ["diagnostics.cjs", "session-cleanup.cjs", "computer-console.cjs"])
    assert.ok(files.includes(entry), `${entry} отсутствует в build.files`);
});
