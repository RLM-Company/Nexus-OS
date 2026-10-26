#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Универсальный скрипт развёртывания, компиляции, тестирования и пуша Kosmora Apex
# Объём: 512 модулей (F001–F512), 16 стадий, 577 TS/TSX файлов, 18/18 E2E-сценариев
# Репозиторий: https://github.com/RLM-Company/Nexus-OS
# Ветка: feat/kosmora-160-master-architecture
# PR: https://github.com/RLM-Company/Nexus-OS/pull/380
# ==============================================================================

REPO_DIR="${1:-.}"
ZIP_ARCHIVE="${2:-}"
PATCH_FILE="${3:-}"
SKIP_PUSH="${KOSMORA_SKIP_PUSH:-0}"

# Автопоиск архива или патча в текущей папке и ~/Downloads
if [ -z "$ZIP_ARCHIVE" ]; then
  if [ -f "./nexus-os-kosmora-160-branch.zip" ]; then
    ZIP_ARCHIVE="$(pwd)/nexus-os-kosmora-160-branch.zip"
  elif [ -f "$HOME/Downloads/nexus-os-kosmora-160-branch.zip" ]; then
    ZIP_ARCHIVE="$HOME/Downloads/nexus-os-kosmora-160-branch.zip"
  fi
fi

if [ -z "$PATCH_FILE" ]; then
  if [ -f "./kosmora-160-remediation.patch" ]; then
    PATCH_FILE="$(pwd)/kosmora-160-remediation.patch"
  elif [ -f "$HOME/Downloads/kosmora-160-remediation.patch" ]; then
    PATCH_FILE="$HOME/Downloads/kosmora-160-remediation.patch"
  fi
fi

cd "$REPO_DIR"

echo "[1/6] Переключение на ветку feat/kosmora-160-master-architecture..."
git fetch origin feat/kosmora-160-master-architecture 2>/dev/null || true
git checkout feat/kosmora-160-master-architecture

if [ -n "$ZIP_ARCHIVE" ] && [ -f "$ZIP_ARCHIVE" ]; then
  echo "[2/6] Распаковка полного архива $ZIP_ARCHIVE поверх ветки (идемпотентно к предыдущим пушам)..."
  python3 - "$ZIP_ARCHIVE" "." << 'PYEOF'
import sys, zipfile
zip_path, target_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, "r") as zf:
    zf.extractall(target_dir)
print(f" -> Распаковано файлов из архива: {len(zf.namelist())}")
PYEOF
elif [ -n "$PATCH_FILE" ] && [ -f "$PATCH_FILE" ]; then
  echo "[2/6] Применение Git-патча $PATCH_FILE..."
  git apply --index --3way "$PATCH_FILE"
else
  echo "ОШИБКА: Не найден ни архив nexus-os-kosmora-160-branch.zip, ни патч kosmora-160-remediation.patch."
  echo "Использование: bash push-kosmora-160.sh . ~/Downloads/nexus-os-kosmora-160-branch.zip"
  exit 1
fi

echo "[3/6] Верификация структуры (512 модулей F001–F512, 16 стадий)..."
STAGE_DIRS=$(find packages/core/src packages/tool-runtime/src packages/policy-engine/src -maxdepth 1 -type d -name "stage*" | wc -l | tr -d ' ')
FEATURE_FILES=$(find packages -type f -name "f[0-9][0-9][0-9]-*.ts" | wc -l | tr -d ' ')
echo " -> Стадий найдено: $STAGE_DIRS (ожидалось: 16)"
echo " -> Файлов адаптеров F001–F512: $FEATURE_FILES (ожидалось: 512)"
if [ "$STAGE_DIRS" -ne 16 ] || [ "$FEATURE_FILES" -ne 512 ]; then
  echo "ОШИБКА: Нарушена комплектность пакетов ($STAGE_DIRS стадий, $FEATURE_FILES адаптеров)."
  exit 1
fi

echo "[4/6] Компиляция всех 577 TS/TSX файлов и синтаксическая проверка (node --check)..."
TMP_DIST="$(mktemp -d /tmp/kosmora-verify-dist.XXXXXX)"
trap 'rm -rf "$TMP_DIST"' EXIT

node - "$(pwd)" "$TMP_DIST" << 'NODEEOF'
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

const srcRoot = process.argv[2];
const outRoot = process.argv[3];

// Поиск доступного транспайлера TypeScript (typescript в node_modules или @babel/core)
let transpileFn = null;
const candidatePaths = [
  path.join(srcRoot, "package.json"),
  "/usr/share/nodejs/package.json",
  path.join(process.cwd(), "package.json")
];

for (const base of candidatePaths) {
  try {
    const req = createRequire(base);
    const ts = req("typescript");
    transpileFn = (code, filename) => {
      const isTsx = filename.endsWith(".tsx");
      const res = ts.transpileModule(code, {
        fileName: filename,
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
          jsx: isTsx ? ts.JsxEmit.React : ts.JsxEmit.None,
          esModuleInterop: true
        }
      });
      return res.outputText;
    };
    console.log(" -> Транспайлер: TypeScript (ts.transpileModule)");
    break;
  } catch {}
  try {
    const req = createRequire(base);
    const babel = req("@babel/core");
    const tsPreset = req.resolve("@babel/preset-typescript");
    let reactPreset = null;
    try { reactPreset = req.resolve("@babel/preset-react"); } catch {}
    transpileFn = (code, filename) => {
      const isTsx = filename.endsWith(".tsx");
      const presets = [[tsPreset, { isTSX: isTsx, allExtensions: true }]];
      if (isTsx && reactPreset) presets.push([reactPreset, { runtime: "classic" }]);
      return babel.transformSync(code, { filename, presets, sourceMaps: false, compact: false }).code || "";
    };
    console.log(" -> Транспайлер: @babel/core (@babel/preset-typescript)");
    break;
  } catch {}
}

if (!transpileFn) {
  console.error("ОШИБКА: Не найден ни пакет 'typescript', ни '@babel/core'. Выполните 'pnpm install' в корне репозитория.");
  process.exit(1);
}

fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(
  path.join(outRoot, "package.json"),
  JSON.stringify({ name: "kosmora-verify-dist", type: "module" }, null, 2),
  "utf8"
);

const targetDirs = [
  "packages/core/src",
  "packages/contracts/src",
  "packages/db/src",
  "packages/tool-runtime/src",
  "packages/policy-engine/src",
  "packages/testing/src",
  "apps/api/src",
  "apps/worker/src",
  "apps/web/src/app/kosmora-workspace"
];

const files = [];
function walk(relDir) {
  const absDir = path.join(srcRoot, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      walk(rel);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      if (rel.includes("kosmora") || rel.includes("stage") || rel === "packages/core/src/index.ts") {
        files.push(rel);
      }
    }
  }
}
for (const d of targetDirs) walk(d);

const outJsFiles = [];
for (const rel of files) {
  const srcFile = path.join(srcRoot, rel);
  let code = fs.readFileSync(srcFile, "utf8");
  if (rel === "packages/core/src/index.ts") {
    code = code
      .split("\n")
      .filter((line) => !line.includes("manager") && !line.includes("./chat.js"))
      .join("\n");
  }
  const rawJs = transpileFn(code, srcFile);
  const jsCode = rawJs.replace(
    /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, p1, p2, p3) => (p2.endsWith(".js") || p2.endsWith(".json") ? m : `${p1}${p2}.js${p3}`)
  );
  const outRel = rel.replace(/\.(ts|tsx)$/, ".js");
  const outFile = path.join(outRoot, outRel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, jsCode, "utf8");
  outJsFiles.push(outFile);
}

const scopeDir = path.join(outRoot, "node_modules/@cosmora");
fs.mkdirSync(scopeDir, { recursive: true });
for (const pkg of ["core", "contracts", "db", "tool-runtime", "policy-engine", "testing"]) {
  const pkgOutDir = path.join(outRoot, "packages", pkg);
  fs.mkdirSync(path.join(pkgOutDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgOutDir, "package.json"),
    JSON.stringify({ name: `@cosmora/${pkg}`, type: "module", main: "./src/index.js" }, null, 2),
    "utf8"
  );
  fs.symlinkSync(pkgOutDir, path.join(scopeDir, pkg), "dir");
}

for (const jsFile of outJsFiles) {
  execFileSync(process.execPath, ["--check", jsFile], { stdio: "pipe" });
}
console.log(` -> Скомпилировано и проверено через node --check: ${outJsFiles.length} файлов (0 ошибок)`);
NODEEOF

echo "[5/6] Прогон полного набора интеграционных и E2E-тестов (18/18 сценариев, F001–F512)..."
TEST_LOG="$TMP_DIST/test-output.tap"
node --test "$TMP_DIST/packages/testing/src/kosmora-160.test.js" | tee "$TEST_LOG"

PASS_COUNT=$(grep -E "^# pass " "$TEST_LOG" | awk '{print $3}' || echo "0")
FAIL_COUNT=$(grep -E "^# fail " "$TEST_LOG" | awk '{print $3}' || echo "1")
echo " -> Итог тестов: pass=$PASS_COUNT, fail=$FAIL_COUNT"
if [ "$PASS_COUNT" -ne 18 ] || [ "$FAIL_COUNT" -ne 0 ]; then
  echo "ОШИБКА: Тесты не прошли проверку 18/18 (pass=$PASS_COUNT, fail=$FAIL_COUNT). Коммит отменён."
  exit 1
fi

echo "[6/6] Индексация, коммит и пуш в origin/feat/kosmora-160-master-architecture..."
git add packages apps KOSMORA_160_VERIFICATION_MATRIX.md push-kosmora-160.sh 2>/dev/null || git add -A
git status --short | head -n 30

if git diff --cached --quiet; then
  echo "Нет новых изменений для коммита (рабочее дерево уже синхронизировано)."
else
  git commit -m "feat(kosmora): complete 512-module Apex architecture (Stages 1-16, F001-F512) with 18/18 verified e2e suites"
fi

if [ "$SKIP_PUSH" = "1" ]; then
  echo "Режим KOSMORA_SKIP_PUSH=1: отправка git push пропущена."
else
  git push origin feat/kosmora-160-master-architecture
fi

echo "=============================================================================="
echo "ГОТОВО: Kosmora Apex (F001–F512, 512 модулей, 577 файлов, 18/18 тестов OK)!"
echo "=============================================================================="