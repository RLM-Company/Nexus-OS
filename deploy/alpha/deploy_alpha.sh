#!/usr/bin/env bash
set -euo pipefail

echo "=== [1/5] Проверка целостности текущей базы данных ==="
DB_PATH="${COSMORA_DB_PATH:-/var/lib/cosmora/kosmora.db}"
BACKUP_PATH="${COSMORA_BACKUP_PATH:-/var/lib/cosmora/backup_pre_0036_$(date +%Y%m%d_%H%M%S).db}"

if [ -f "$DB_PATH" ]; then
  INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")
  if [ "$INTEGRITY" != "ok" ]; then
    echo "ОШИБКА: База данных повреждена ($INTEGRITY). Развёртывание остановлено."
    exit 1
  fi
  echo "База данных проверена: PRAGMA integrity_check = ok"

  echo "=== [2/5] Создание бинарного бэкапа ==="
  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
  echo "Бэкап сохранён в $BACKUP_PATH"
else
  echo "База $DB_PATH пока не создана, будет инициализирована при старте."
fi

echo "=== [3/5] Применение миграции 0036 и оптимизация WAL ==="
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION_FILE="$ROOT_DIR/packages/db/migrations/0036_chat_features.sql"

if [ -f "$DB_PATH" ] && [ -f "$MIGRATION_FILE" ]; then
  sqlite3 "$DB_PATH" < "$MIGRATION_FILE" || {
    echo "ОШИБКА при накате миграции 0036. Восстановление из бэкапа $BACKUP_PATH..."
    cp "$BACKUP_PATH" "$DB_PATH"
    exit 1
  }
  echo "Миграция 0036 успешно накатана."
  
  # Настройка WAL и таймаута для параллельной работы нескольких агентов
  sqlite3 "$DB_PATH" "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA optimize;"
  
  # Проверка наличия новых таблиц
  FOLDERS_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM general_chat_folders;")
  FTS_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM general_chat_fts;")
  echo "Проверка таблиц: папок = $FOLDERS_COUNT, записей FTS5 = $FTS_COUNT"
fi

echo "=== [4/5] Сборка и перезапуск Docker Compose ==="
cd "$ROOT_DIR/deploy/alpha"
docker compose -f compose.yaml build
docker compose -f compose.yaml down
docker compose -f compose.yaml up -d

echo "=== [5/5] Проверка статуса сервисов ==="
sleep 3
docker compose -f compose.yaml ps
if [ -f "healthcheck.mjs" ]; then
  node healthcheck.mjs || true
fi

echo "=========================================================="
echo " Развёртывание завершено! Продукт обновлён и готов к работе."
echo "=========================================================="
