# Проверки

```bash
pnpm --filter @cosmora/web exec vitest run src/app/chat-task-plan.test.ts src/app/clarification-card-state.test.ts src/app/task-runtime-evidence.test.ts
KOSMORA_E2E_PRODUCTION=1 pnpm --filter @cosmora/web exec playwright test e2e/chat-task-plan.spec.ts e2e/clarification-card.spec.ts e2e/work-progress-refresh.spec.ts e2e/supplier-work-handoff.spec.ts e2e/manager-work-stops.spec.ts e2e/stars-task-restore.spec.ts e2e/code-agent.spec.ts e2e/media-job-recovery.spec.ts
```

Сценарий переключения двух планов удерживает запоздавший ответ первого плана, затем обрывает чтение второго и восстанавливает связь. Существующий сценарий сравнения поставщиков проверяет серверный вопрос, reload, конфликт версии, потерянный ответ и чтение одного результата. Временные замеры не включают разрывы истории и неизвестные интервалы. Независимо проверяются поздний результат после отмены медиа и регрессия версии Stars.

Stars по реальному API создаёт две разные миссии, открывает первую по ID, восстанавливает её после перезагрузки и показывает явный отказ для неизвестного ID. Новый код не читает последнюю миссию по умолчанию, если пользователь открыл недоступную ссылку. Проверки состояния и работы провайдеров на разрешённом стенде учитываются отдельно.
