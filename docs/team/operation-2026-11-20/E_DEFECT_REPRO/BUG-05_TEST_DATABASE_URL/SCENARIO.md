# BUG-05: Windows-путь в assertion теста лаунчера

**Владелец:** 01_CODEX (demo/launcher tooling); платформенный комментарий —
03_OPENCODE (Windows). **Обнаружено:** локальный прогон 20.11.2026.

## Минимальные данные

[input.json](input.json) — точный вход теста
`the launcher discards inherited paid routes...` из
`scripts/test/presentation-demo.test.mjs:13-50`, включая `DATABASE_URL`
и изолированный каталог. Секреты в `input` — фиктивные строки теста.

## Шаги

1. На Windows, Node 24+, из корня репозитория выполнить:
   `node --test scripts/test/presentation-demo.test.mjs`.
2. Прочитать результат первого теста и значение `env.DATABASE_URL`.
3. Повторить на POSIX-окружении или с нормализованным разделителем.

## Ожидаемое поведение

См. [EXPECTED.md](EXPECTED.md). Дефект относится к тестовой инфраструктуре,
не к пользовательскому продукту и не к экспорту дропа.
