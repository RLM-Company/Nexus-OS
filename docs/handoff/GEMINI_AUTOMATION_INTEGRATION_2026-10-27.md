# Адаптация веток Gemini и соседних блоков

База интеграции: `cac76974c2d3b605f19bf1a7e163b0bf060d2969` (PR400).
Исходный пакет: `google/gemini-mission-knowledge-20261027` @
`09f2409140dde2f7c5418e8383051701de4a4534`, 37 файлов / 38 479 добавленных строк.
Это объём исходного снимка, не количество работающих функций.

## Что заменено при интеграции

Исходный отдельный node:http control plane, собственные bearer-токены, Python
SQLite fallback, DDL в конструкторах и старые Apex-каталоги не подключаются.
Детерминированный агент снимка не является production runtime: он создавал
шаблонные артефакты, а Promise от настоящего адаптера отвергался.

Полезные доменные возможности адаптированы к реальным Fastify identity,
owner/project scope, существующим Work DAG и нативной SQLite Kosmora.
Новая managed migration — `0053_project_automation`; миграция не меняет прежние
таблицы. HTTP-клиент не может передать owner, principal или tenant.

| Блок        | Реально подключено                                                                                                                                  | Граница                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Missions    | Список/создание существующих Work DAG, зависимости и контроль через реальный Work coordinator                                                       | Нет второго «симулированного» агента                               |
| Playbooks   | 5 начальных шаблонов, публикация неизменяемых версий с SHA-256, буквальные переменные, preview, архив, идемпотентная атомарная материализация в DAG | Не выдаёт новых разрешений инструментам                            |
| Schedules   | UTC one-shot/interval, pause/resume с CAS, устойчивые occurrences, объединение пропущенных интервалов и повторяемое принятие владельцем             | Tick вызывается явно; модель автоматически не стартует             |
| Evaluations | Неизменяемые наборы exists/contains/not_contains/min_chars; проверка завершённых опубликованных файлов с hash и receipt                             | Это структурные проверки, не оценка истинности и не LLM benchmark  |
| Knowledge   | Коллекции проверенных ссылок на документы, память, Canvas и Work; проверка точной версии/хеша/диапазона при каждом context                          | Изменённый/удалённый источник не получает вечное разрешение чтения |

Сохраняются существующие policy, autonomy, emergency stop и учёт расходов Work.
Принятие шаблона/расписания создаёт план без модельного запроса. Старт выполняется
штатным действием Work; его ограничения не обходятся.

Все изменения синхронны и транзакционны. Составная запись DAG и receipt использует
savepoints внутри общего native SQLite transaction. Есть durable global/Work
privacy fences, обязательный production privacy adapter, полный экспорт новых
записей и удаление данных одного владельца. Лимиты: 200 записей вида на проект,
128 KiB на запись, 8 MB на владельца; отказ при превышении, без скрытой обрезки.

## API

Основа: `/api/v1/projects/:projectId/automation`, только verified owner session.
GET: `status`, `missions`, `playbooks`, `playbook-versions`, `instantiations`,
`schedules`, `occurrences`, `suites`, `evaluations`, `collections` и их `/:id`.

POST:

- `missions`, `missions/:id/control` — штатные Work DAG contracts.
- `playbooks` — `{client_request_id,title,definition}`; definition содержит
  `title_template`, `variables:[{key,label,required,default_value?}]`, `nodes`.
- `playbooks/seed` — пять редактируемых шаблонов без выполнения.
- `playbooks/:id/publish`, `archive`, `preview`, `instantiate` — pinned version,
  CAS или client request key согласно contracts. Подстановка `{{key}}` буквальная.
- `schedules` — pinned playbook/version/variables, точный `due_at` в UTC,
  `interval_seconds:null` или 60–31 622 400. `tick` сохраняет due occurrences;
  `occurrences/:id/accept` идемпотентно создаёт план.
- `suites`, `suites/:id/evaluate` — правила, затем `{work_id,client_request_id}`.
- `collections`, `collections/:id/context` — ссылки из project knowledge search;
  контекст совместим с существующими вложениями материалов чата и Work.

## Остальные ветки

PR401 @ `35dcd3623f6ae1660cea43a910bb5dbce989803d`: перенесены MFA suspend/restore
служебных actor. Владелец защищён, прежние сессии после restore не воскресают.
Дополнительно исправлены CAS записи и добавлен неизменяемый журнал с target,
performer, причиной и временем (`0054_actor_moderation_audit`). Это security audit,
сохраняемый при удалении пользовательских данных. UI не менялся.

PR402 @ `22b1392e69013cb472bae7a2d65c97271483980c`: перенесены Pay store, HTTP
contracts и optional gateway. Миграция 0020 перенумерована в `0055_kosmora_pay`,
чтобы не столкнуться с действующим журналом. Добавлены одноразовый durable dispatch,
запрет повторного POST после неопределённого исхода, immutable identity/terminal
status, ожидание in-flight операций при закрытии API и no-store заголовки.

**Production checkout намеренно выключен:** сервер не создаёт gateway даже при
наличии старых переменных окружения. Нет реальных транзакций, подписок и повторов.
Коммерческий запуск, настройки магазина, чеки/возвраты и customer lifecycle —
отдельный блок. Это не готовая публичная биллинговая система.
Особенности идемпотентности сверялись с
[официальным форматом API ЮKassa](https://yookassa.ru/developers/using-api/interaction-format).

Обновлённая цепочка графа из `codex/integrate-work-presentations-20261017` @
`7b81848785e3eb673b8d18f9e354381d457f62da`: чистая логика citation refresh,
source usage и comparison перенесена в Core. Три API работают с проверенными
серверными ревизиями; preview ничего не пишет, существующий cite_edge CAS остаётся.
Интерфейсные панели записаны в visual waitlist.

## Что не следует объявлять законченным

Отдельные панели пяти доменов и платежей отложены по запрету менять визуал.
Не переносятся непроверенные webhook/cron/SSE, автоматические внешние действия,
секретные переменные шаблонов, LLM judge/benchmark и организационная RBAC исходного
снимка. Расширения требуют настоящих адаптеров и отдельных проверок; 512 позиций
каталога Apex не превращаются от этого в 512 готовых продуктовых функций.

В репозитории при сверке было 421 branch head. 108 — точные предки базы этого
кандидата; остальные включают старые альтернативы и squash/cherry-pick историю.
Число non-ancestor веток не используется как процент незавершённости. Старые UI
версии не сливаются обратно поверх утверждённого интерфейса.

Выкладка и точные итоги проверок фиксируются отдельно после завершения активации.
