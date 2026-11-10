# Развёртывание и активация Google Drive на Alpha VPS

Документ описывает процедуру активации резервного копирования в Google Drive для Alpha VPS Kosmora в соответствии с PR #425 и PR #426.

## 1. Предварительные требования

1. Действующий домен с настроенным публичным TLS-сертификатом (`COSMORA_DEMO_DOMAIN`).
2. Проект в Google Cloud Console с включённым Google Drive API v3.
3. OAuth 2.0 Client ID (тип приложения: Web application) с разрешённым URI перенаправления:
   `https://${COSMORA_DEMO_DOMAIN}/api/cloud-storage/google-drive/callback`.
4. Сгенерированный 32-байтный hex-ключ для симметричного шифрования токенов AES-256-GCM:
   ```bash
   openssl rand -hex 32
   ```

## 2. Настройка конфигурации на сервере

1. Создайте файл `deploy/alpha/private/drive.env` на основе примера `deploy/alpha/drive.env.example`:
   ```bash
   cp deploy/alpha/drive.env.example deploy/alpha/private/drive.env
   chmod 600 deploy/alpha/private/drive.env
   ```
2. Заполните переменные:
   - `GOOGLE_DRIVE_CLIENT_ID`
   - `GOOGLE_DRIVE_CLIENT_SECRET`
   - `GOOGLE_DRIVE_REDIRECT_URI`
   - `GOOGLE_DRIVE_ENCRYPTION_KEY`

## 3. Применение миграций БД

Перед первым запуском примените миграции `0060_drive_storage.sql`, `0061_drive_snapshots.sql` (или консолидированную `0063_unified_stage2_extensions.sql`):
```bash
pnpm --filter @cosmora/db migrate
```

## 4. Перезапуск контейнеров

```bash
docker compose -f deploy/alpha/compose.yaml down
docker compose -f deploy/alpha/compose.yaml up -d
```

## 5. Проверка работоспособности

1. Войдите в веб-интерфейс Kosmora (`https://${COSMORA_DEMO_DOMAIN}`).
2. Перейдите в **Личные настройки** -> **Хранилище Google Drive**.
3. Нажмите **Подключить Google Drive** и завершите OAuth-согласие.
4. Выполните тестовое сохранение резервной копии и проверьте появление файла `manifest.json` в каноническом архиве.
5. Проверьте предпросмотр и безопасное восстановление снимка в новый чат.
