# CHECKPOINT — 04_DEEPSEEK

- **Обновлено:** цель завершена по указанию владельца после среза A.
- **Статус:** готово к интеграции; **петля остановлена**, фонового процесса нет.
- **BASE_SHA:** `9d972e8ba447f681fbfb49253b73d9f02dd1d325`
- **Ветка:** `ops/deepseek-memory` (создана от BASE_SHA, `main` на начало работ совпадал с базой).
- **HEAD_SHA:** `6c44cb4405dc43725d54b9def39e780d0dd92b00` — код среза A;
  финальный doc-коммит с этой записью указан в `git log -1` ветки.
- **Точка продолжения при следующем запуске:** прочитать этот файл, затем
  `git fetch origin main`, проверить новые общие контракты и при необходимости
  влить `main` (не выбирая автоматически «свою версию»). Начать со среза B.
- **PR:** [#513](https://github.com/RLM-Company/Nexus-OS/pull/513), `CLEAN / MERGEABLE / OPEN`, без merge/deploy.
- **Финальный CI:** `42892932896` — все четыре проверки pass (Verify monorepo 5m5s,
  Browser acceptance 9m13s, Code sandbox isolation, identity-tests).
- **main при завершении:** `5e01c4f` (ушёл вперёд на 10+ коммитов; мои файлы
  не задеты, конфликтов нет, PR остаётся `CLEAN`).

## Выполнено (срез A)

1. Разведка активных entrypoints; прототипы `apex/**` и bench-скрипты отделены
   от продуктовой цепочки. BACKLOG.md составлен.
2. Машинный сигнал `answer_evidence` / `matched_items` / `evidence.matched`
   в контракте, store, packing и evidence-selection.
3. Async re-check владельца/цели после `await` в `resolveAsync`,
   `SemanticHistoryIndex.resolve` и `fuseSemantic`.
4. Фиксированная панель `packages/db/test/memory-answer-evidence.test.ts` —
   9 сценариев: matched, absent (с обязательным ограничением), disabled,
   contradiction, forget, revoke, cross-owner, async fence ×2.
5. Полные прогоны: db 203/203, api 985/985, core 50/50, typecheck/lint/prettier/
   secrets/build зелёные.

## Точная точка продолжения

**Срез B — диагностика причин выбора источника.**

- Где: `apps/web/src/app/context-memory-settings.tsx` (существующий раздел),
  серверный `sourceFor()` уже есть в `ContextMemoryStore`; маршрут
  `/api/v1/memory/targets/:kind/:targetId/source` уже зарегистрирован.
- Что сделать: в предпросмотре/usage показать, почему запись попала в контекст —
  grant (scope), `matched`/overlap, `retrieval_rank`, `source_status`,
  `answer_evidence`; связать `reference` с дочитыванием оригинала по запросу.
  Без новой панели, без изменения компоновки/дизайна (иначе VISUAL_WAITLIST.md).
- Обязательно: не включать memory OFF, не поднимать тарифы/права, не трогать
  chat/sidebar/logo/global CSS.
- Тесты: причина выбора для matched/absent, отзыв grant убирает причину,
  дочитывание оригинала по `reference` после сжатия.

**Срез C — единая панель измерений baseline/после**: recall/precision,
неподтверждённые ответы, размер контекста (байты), задержка, forget/revoke/
restart, cross-owner; сравнение с текущим baseline на одном корпусе, с явными
ограничениями (без выдуманных процентов экономии).

## Известные состояния, требующие внимания при следующем запуске

- `main` может уйти вперёд: перед продолжением сделать `git fetch origin main`,
  проверить новые общие контракты и при необходимости влить `main` в ветку,
  не выбирая автоматически «свою версию» при конфликте.
- Возможна коллизия номеров миграций с чужими PR: перед новой миграцией
  проверить `packages/db/migrations/` и journal; номер согласует Codex.
- Не повторять неизменившийся сбой: в срезе A дважды проявлялась одна и та же
  причина (рост сериализованного bundle + удлинение правил) — пересмотрена и
  устранена содержательно. При новом повторе менять подход.

## Правила, не потерять

- Статус не выше «готово к интеграции»; живая приёмка/выпуск — за Codex.
- Отчёты только в `docs/team/operation-2026-11-10/deliveries/04_DEEPSEEK/`.
- Внешние зависимости — только фикстуры в тестах, live-статус отдельно.
- Не читать .env/токены/БД пользователей; не слать сообщения, не публиковать,
  не merger, не VPS, не обучать веса, не включать Multi-Agent/Jarvis.
