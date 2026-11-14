# Итоговая приёмка Coscode

Inputs/output/diff реального CI-прогона публикуются существующим OCI job как
artifact `coscode-final-workflow-proof`: два каталога coscode-final-git и coscode-final-api.
Первый содержит настоящие input.json/output.json/changes.patch/receipt.json с failure,
success и cancel. Второй — input.json/reviewed.json/output.json/changes.patch/receipt.json
полного API → authenticated loopback HTTP executor → real OCI → bounded repair →
owner review → Draft PR adapter. Publication в нём fixture, не live GitHub write.
CI требует непустой API receipt после теста; пропуск opt-in не станет зелёной приёмкой.

Источник inputs — существующие scoped tests code-agent-git.oci.test.ts и
code-agent.test.ts, один расширенный opt-in case `real OCI API repair`.
Модель и GitHub заменены fixtures; Git/Node/HTTP/SQLite/OCI/readback настоящие.

Локально151 API/adapter tests,76 runtime unit и16 web unit PASS, types/lint0.
Один API OCI opt-in не проходил локально: Docker VFS ENOSPC до выполнения кода;
оба диагностических ответа unavailable сохранены, Docker storage не очищался.
`first-probe-loader-failed.log` — ошибка launcher cwd, не исполнение snapshot.
Исходные ошибки не скрываются повторным запуском. Контейнерные права/сеть прежние.
Временные директории с report output не выдаются за свежие успешные outputs.

`scope-and-results.json` разделяет локальные результаты, source SHA и обязательный CI.
`changes.patch` содержит реальные изменения двух файлов приёмки/CI.
`SHA256SUMS` относится к приложенным файлам после нормализации логов.
[Матрица, запуск и границы](../../COSCODE_FINAL_ACCEPTANCE_RU.md).
