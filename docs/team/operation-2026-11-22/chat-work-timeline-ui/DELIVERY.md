# DELIVERY — work timeline card in web

- **Статус:** готово к интеграции.
- **BASE_SHA:** `e7bc41564769070912f9be15b18a352acfa0ae0a` (main после #619).
- **Ветка:** `stage3/chat-work-timeline-ui`. **PR:** без merge.

## Что сделано

- `apps/web/src/app/work-timeline-card.tsx` — компактная карточка плана/таймера
  работы. Принимает `WorkTimelineSource`, вызывает чистый
  `projectWorkTimeline()` из `@cosmora/core` и показывает `progress`, заголовок
  из `plan.summary`, ошибки через `role="alert"`, список событий с типом
  `control|model|diagnostic` и время. CSS — отдельный module.
- Компонент **не встроен** в `page.tsx`, sidebar или composer: по `UI_RULES.md`
  главный экран/чат меняются только точечным запросом владельца. Карточка
  самодостаточна и готова к монтированию в согласованной точке.
- `apps/web/package.json` — добавлен workspace-dep `@cosmora/core`, lockfile
  обновлён.

## Живые данные в тестах

`work-timeline-card.test.tsx` (2 теста, `renderToStaticMarkup`) использует
реальные события прогонов 2026-11-22:

- `edcc0468…` — `awaiting_approval`, «План подготовлен», 1 model request;
- `b5f2297f…` — `PROVIDER_ERROR`, диагностика `INCOMPLETE_TEXT_RESPONSE`.

## Полный живой draft — ограничение деплоя

Одобрил план `edcc0468…` (`/work/:id/control`, `{version:13,action:"approve"}`
→ 200, событие «План подтверждён владельцем»), но draft остановился с
`EXECUTION_BUDGET_EXCEEDED`: deployed схема хард-кэпит `max_model_requests` на 3
(проверено в `/opt/kosmora/releases/…/packages/contracts/src/manager-work.ts`:
`minimum: 2, maximum: 3`), а coordinator требует `model_requests + 2` при
`needs_critic`. Запрос с `max_model_requests: 6` → 400 VALIDATION_ERROR.
Положительный живой результат (реальный план подготовлен, явное ожидание
одобрения) тем не менее зафиксирован. Для полного draft нужно изменение
deployed-лимита — вне зоны задачи, не делал.

## Проверки

```
apps/web test/work-timeline-card.test.tsx   2 passed
web typecheck 0 · web lint 0 · prettier --check . · check-secrets — green
```

Merge не делаю без указания.
