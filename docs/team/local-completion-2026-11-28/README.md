# Завершение функций — команда из 11 чатов

Дата: 28 ноября 2026, Москва. База: main `132e609d7c6c47b13097437e3b56fe2bb5187ed7`.
Пакет подготовлен для ручной рассылки владельцем. Чаты автоматически не запускались.
Grok/Gemini в этой волне не назначены. Предыдущий пакет с шестью Harness заменён
этим распределением; завершённые реализации сохраняются.

Для каждого чата открой соответствующий файл и скопируй **весь текст**. Он указывает,
где прочитать [общие правила](00_COMMON_RU.md). Использовать отдельные worktree.

| Кому                   | Промт                                                            | Основная зона                       |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| Второй разработчик GPT | [01_DEVELOPER_RESEARCH_RU.md](01_DEVELOPER_RESEARCH_RU.md)       | Research и быстрый поиск            |
| OpenCode 1             | [02_OPENCODE_AUTOMATION_RU.md](02_OPENCODE_AUTOMATION_RU.md)     | Автоматизация                       |
| OpenCode 2             | [03_OPENCODE_INTEGRATIONS_RU.md](03_OPENCODE_INTEGRATIONS_RU.md) | Реальные внешние сервисы, HTTP/MCP  |
| OpenCode 3             | [04_OPENCODE_DESKTOP_RU.md](04_OPENCODE_DESKTOP_RU.md)           | ПК, браузер и Windows-клиент        |
| OpenCode 4             | [05_OPENCODE_KOSCODE_RU.md](05_OPENCODE_KOSCODE_RU.md)           | Koscode, проверки, GitHub           |
| OpenCode 5             | [06_OPENCODE_GAMES_SITES_RU.md](06_OPENCODE_GAMES_SITES_RU.md)   | Games и Sites                       |
| OpenCode 6             | [07_OPENCODE_MEDIA_RU.md](07_OPENCODE_MEDIA_RU.md)               | Медиа и презентации                 |
| DeepSeek Harness 1     | [08_HARNESS_STARS_RU.md](08_HARNESS_STARS_RU.md)                 | Stars и удалённый исполнитель       |
| DeepSeek Harness 2     | [09_HARNESS_MEMORY_FILES_RU.md](09_HARNESS_MEMORY_FILES_RU.md)   | Память → Skills → анализ файлов     |
| DeepSeek Harness 3     | [10_HARNESS_VOICE_RU.md](10_HARNESS_VOICE_RU.md)                 | Голосовой агент и встречи           |
| Codex                  | [11_CODEX_API_INTEGRATION_RU.md](11_CODEX_API_INTEGRATION_RU.md) | API, общее сведение; затем скорость |

## Границы совместной работы

- Automation: OC1 владеет расписанием/inbox; OC2 поставляет события сервисов;
  Stars использует тот же scheduler. Публичный developer outbox — Codex.
- Device: OC3 владеет native input/IPC/leases; Games, голос и Stars вызывают его
  интерфейс. Изолированное выполнение кода Koscode — OC4.
- Media: OC6 владеет TTS/audio transport и playback; Harness 3 владеет голосовым
  диалогом, STT/VAD и meeting adapters.
- Memory: Harness 2 владеет извлечением/контекстом/файловым анализом;
  Research поставляет evidence, OC2 — Drive transport. Membership не дублируется.
- Общие contracts/exports/migrations/app/server: минимальные отдельные integration
  commits; финальные конфликты и журнал миграций сводит Codex.
- Совместную работу нескольких аккаунтов проверяет интегратор. Если обнаружится
  самостоятельный существенный разрыв реализации, он получит отдельного владельца.

Начинать с пользовательского результата и отсутствующего production-пути, а не
со сборки нового отчётного пакета. Фикстуры полезны, но сами по себе не закрывают
задание реальной интеграции/модели/ПК. Дизайн, обучение и тарифы не расширяем.

`manifest.json` содержит назначение и подготовленные статусы. Статус меняется по
полученным фактам, а не автоматически от наличия инструкции.
