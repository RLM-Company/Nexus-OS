# Воспроизводимая сборка Linux x86-64 из точного SHA

Этот комплект готовит **release candidate** для тестовой инфраструктуры. Он не
выполняет выкладку на рабочий VPS — её ведёт владелец вручную.

## Что сдаётся

1. `scripts/build-release.mjs` — воспроизводимый исходный артефакт из точного SHA.
2. `scripts/build-image.mjs` — сборка закреплённого OCI-образа `linux/amd64` с
   фиксацией digest, размера и требований к диску/памяти.
3. `scripts/rehearse-release.mjs` — изолированный прогон API + web с mock-провайдером
   и временной SQLite: healthcheck, миграции, повторный запуск, восстановление версии.
4. `deploy/release/deploy-release.sh` — протокол apply/rollback с fail-closed
   проверкой диска и выбором образа только по digest.
5. GitHub Actions workflow `.github/workflows/linux-release.yml` — воспроизводимая
   сборка и полный rehearsal в CI.

## Воспроизводимая команда (Linux x86-64, тестовая инфраструктура)

```sh
SHA=$(git rev-parse HEAD)                       # точный коммит, дерево должно быть чистым
node scripts/build-release.mjs "$SHA" /tmp/kosmora-release rc-1
node scripts/build-image.mjs --release /tmp/kosmora-release/kosmora-linux-x64-rc-1
node scripts/rehearse-release.mjs               # mock-провайдер + временная БД
```

Артефакт: каталог `/tmp/kosmora-release/kosmora-linux-x64-rc-1/` с
`manifest.json` (SHA/source.tar.gz), `build.json` (digest/размер/требования) и
`rehearsal.json` (протокол прогона). Повторный запуск `build-release.mjs` с тем же
SHA и toolchain даёт байтово-identичный `source.tar.gz`.

## Зафиксированные требования

| Параметр          | Значение / источник                                                                     |
| ----------------- | --------------------------------------------------------------------------------------- |
| Размер исходников | `manifest.json: source_bytes`, лимит 64 MiB                                             |
| Размер образа     | `build.json: image.bytes` (заполняется CI, `docker image inspect`)                      |
| Место на диске    | `build.json: requirements.disk_bytes` = 2.5×образ + исходники + 512 MiB на SQLite/WAL   |
| Память            | `build.json: requirements.memory_bytes` = 2 GiB на этапе сборки Next; runtime меньше    |
| Платформа         | `linux/amd64`, образ `node:24-bookworm-slim`, pnpm 11.19.0                              |
| Контрольная сумма | SHA-256 исходного архива в `manifest.json`, SHA-256 образа в `build.json: image.digest` |

## Проверки в изолированной среде

- API: `/api/v1/health` → `status=ok`, `database=ok`; `/api/v1/model-runtime` → `mode=mock`.
- Web: `/` отдаёт HTML; `/api/v1/health` через web-прокси тоже здоров.
- Миграции: `packages/db/src/migrate.ts` применяет весь `_journal.json` к временной БД.
- Повторный запуск и «возврат предыдущей версии» перезапускают API на той же схеме;
  SHA-256 файла БД до и после восстановления совпадает.

## Моделирование ошибок

```sh
node scripts/rehearse-release.mjs --low-disk        # отказ до распаковки/миграции/старта
node scripts/rehearse-release.mjs --fail-at migrate # отказ на конкретном шаге
node scripts/build-image.mjs --release <dir> --fail-at docker-build
```

Каждый отказ пишет `failed_stage` и `restore_command` в отчёт. По ошибке видно,
на каком шаге остановилась выкладка, и какая команда возвращает рабочую сборку.

## Протокол отката (для владельца, на тестовой инфраструктуре)

1. Остановить новую версию (API + web). Не удалять том `cosmora_data`.
2. Выбрать **предыдущий** digest из `build.json` предыдущего релиза; никогда `:latest`.
3. Если схема БД несовместима — восстановить snapshot из
   `deploy/alpha/sqlite-backup.mjs` в **новый** том и явно его выбрать. Иначе оставить
   текущий том: миграции 0021–0024 аддитивные, старый образ совместим
   (`deploy/alpha/README.md`, «Database backup and recovery»).
4. Выполнить `bash deploy/release/deploy-release.sh --rollback <digest> <snapshot>`.
5. Повторить healthcheck, миграции и `rehearse-release.mjs`; только после PASS
   открывать доступ. Приложение и БД восстанавливаются отдельными операциями.

## Ограничения

- Реальный OCI-образ и полный rehearsal выполняются в CI (`linux-release.yml`);
  на Windows-хосте нет Docker daemon, поэтому локально проверяются логика
  артефакта, сборка API/web и PHP-независимые сценарии через Node.
- Живой провайдер, реальная выкладка и приёмка на ПК владельца не выполняются.
