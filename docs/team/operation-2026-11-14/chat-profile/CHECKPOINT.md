# CHECKPOINT — stage3/chat-profile

- **Обновлено:** срезы A–E готовы к интеграции в одном PR.
- **BASE_SHA:** `f187fc0c8b83d633174675775c70695a2fefb57c` (head PR #589).
- **Ветка:** `stage3/chat-profile`. **PR:** открывается в `main`, без merge/deploy.
- **Фонового процесса нет.**

## Выполнено

| Срез | Результат                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | `display_name` / `user_gender` / `assistant_gender` в аддитивной миграции (0027 + guarded ALTER), API/контракт, defaults masculine/neutral, обратная совместимость |
| B    | `ownerIdentityPrompt` — единый prompt в ChatService, background chat, relay, Manager/Koswork; Kosmora по имени без угадывания модели                               |
| C    | секция «Профиль» в personal-settings, имя в приветствии, сохранение после перезагрузки                                                                             |
| D    | диктовка: `failed`/`retry()`, «Остановить диктовку», e2e на ошибку→повтор→текст→стоп                                                                               |
| E    | `measure-profile-latency.mjs`: маршрут `timeoutMs 60000→0`, gateway не создаёт таймер                                                                              |

## Проверки

```
api 1100 passed / 1 skipped (1 средовой office-build-cache)
core 425 · db 236 · web typecheck+build 0
typecheck/lint 5 пакетов · prettier · check-secrets · latency — green
```

## Точка продолжения

- CI Linux прогонит e2e диктовки (локально webServer не поднялся).
- Интеграция с #589/#591: сверить общие файлы из DELIVERY.md.
- Живая задержка модели, VPS, ноутбук владельца — отдельно.

## Правила

Статус не выше «готово к интеграции». Не merger без указания, не читать
.env/секреты, не менять тарифы/права, не трогать навигацию проектов (#591).
