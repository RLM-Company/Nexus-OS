# Воспроизводимая проверка поставок цикла исполнения Koswork.
# Запуск из корня репозитория.
$ErrorActionPreference = "Stop"
$node = "node"
$hook = "./scripts/cycle-resolve-hook.mjs"
$flags = @("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--experimental-strip-types", "--import", $hook)

Write-Output "== extractor checks (#666) =="
& $node @flags scripts/check-supplier-extraction.mjs
if ($LASTEXITCODE -ne 0) { throw "extractor checks failed" }

Write-Output "== cycle checks (#670) =="
& $node @flags scripts/check-supplier-cycle.mjs
if ($LASTEXITCODE -ne 0) { throw "cycle checks failed" }

Write-Output "== full cycle run (#672) =="
& $node @flags scripts/koswork-supplier-full-run.mjs
if ($LASTEXITCODE -ne 0) { throw "full run failed" }

Write-Output "== prettier =="
& $node "node_modules/prettier/bin/prettier.cjs" --check .
if ($LASTEXITCODE -ne 0) { throw "prettier failed" }

Write-Output "ALL CHECKS PASSED"
