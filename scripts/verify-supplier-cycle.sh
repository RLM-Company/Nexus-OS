#!/usr/bin/env bash
# Воспроизводимая проверка всех поставок цикла исполнения Koswork.
# Запуск из корня репозитория (после pnpm install --offline --ignore-scripts).
set -euo pipefail

NODE="${NODE:-node}"
HOOK="./scripts/cycle-resolve-hook.mjs"

echo "== extractor checks (#666) =="
"$NODE" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import "$HOOK" scripts/check-supplier-extraction.mjs

echo "== cycle checks (#670) =="
"$NODE" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import "$HOOK" scripts/check-supplier-cycle.mjs

echo "== full cycle run (#672) =="
"$NODE" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
  --import "$HOOK" scripts/koswork-supplier-full-run.mjs

echo "== prettier =="
"$NODE" node_modules/prettier/bin/prettier.cjs --check .

echo "ALL CHECKS PASSED"
