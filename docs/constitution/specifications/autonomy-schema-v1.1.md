# Autonomy Schema Synmetis AI v1.1

> Статус: `RESOLUTION DRAFT / NOT RUNTIME`  
> Дата: `2026-08-24`

## 1. Назначение

Схема превращает рабочие уровни A0–A6 в монотонный набор полномочий. Названия уровней временные; постоянными являются идентификаторы способностей.

## 2. Правило монотонности

Для чистого профиля действует:

`Permissions(A0) ⊆ Permissions(A1) ⊆ ... ⊆ Permissions(A6)`.

Явное расширение более высокого уровня заменяет ограничение младшего для той же способности. Неупомянутое правило наследуется. Формула «всегда применять самое строгое из всех младших уровней» не используется.

## 3. Способности

| ID | Способность |
| --- | --- |
| `context.web.read` | Интернет и открытые источники |
| `context.project.read` | История, файлы и память проекта |
| `context.global.read` | Глобальная память и другие проекты |
| `workspace.write` | Постоянные внутренние изменения |
| `integration.private.use` | Работа в подключённых приватных сервисах |
| `external.communicate` | Сообщения, публикации, встречи и заявки |
| `audience.expand` | Добавление новых адресатов |
| `account.manage` | Создание, изменение и закрытие аккаунтов |
| `production.deploy` | Публичные production-релизы |
| `finance.spend` | Расход фактически доступных средств |
| `finance.credit` | Долг, кредит, рассрочка и овердрафт |
| `legal.accept_terms` | Принятие условий сервисов |
| `contract.finalize` | Окончательные коммерческие договорённости |
| `data.disclose` | Передача внутренних и конфиденциальных данных |
| `agent.manage` | Создание, замена и отключение агентов |
| `prompt.temporary` | Временные проектные инструкции агентов |
| `prompt.permanent` | Постоянные промпты агентов |
| `strategy.change` | Изменение стратегии или цели |
| `sandbox.experiment` | Запуск изолированных экспериментов |

## 4. Режимы полномочия

- `DENY` — запрещено; можно подготовить черновик.
- `CONFIRM` — каждое действие требует подтверждения.
- `SCOPED` — одно подтверждение выдаёт ограниченный scope.
- `AUTONOMOUS` — автономно внутри паспорта, кампании или бюджета.
- `FULL` — полная автономность выбранной категории A6.

## 5. Чистые профили

| Способность | A0 | A1 | A2 | A3 | A4 | A5 | A6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `context.web.read` | DENY | SCOPED | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |
| `context.project.read` | DENY | SCOPED | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |
| `context.global.read` | DENY | SCOPED | SCOPED | SCOPED | SCOPED | SCOPED | FULL |
| `workspace.write` | DENY | DENY | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |
| `integration.private.use` | DENY | SCOPED, только read-only | SCOPED | SCOPED | SCOPED | AUTONOMOUS по паспорту | FULL |
| `external.communicate` | DENY | DENY | CONFIRM | AUTONOMOUS по кампании | AUTONOMOUS по кампании | AUTONOMOUS по паспорту | FULL |
| `audience.expand` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | AUTONOMOUS по критериям паспорта | FULL |
| `account.manage` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | AUTONOMOUS по паспорту | FULL |
| `production.deploy` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | CONFIRM первый, далее AUTONOMOUS | FULL |
| `finance.spend` | DENY | DENY | CONFIRM | CONFIRM | AUTONOMOUS по бюджету | AUTONOMOUS по бюджету | FULL |
| `finance.credit` | DENY | DENY | DENY | DENY | DENY | DENY | FULL, если законно |
| `legal.accept_terms` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | бесплатные стандартные AUTONOMOUS | FULL |
| `contract.finalize` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | CONFIRM | FULL |
| `data.disclose` | DENY | DENY | CONFIRM | AUTONOMOUS для пакета кампании, иначе CONFIRM | AUTONOMOUS для пакета кампании, иначе CONFIRM | AUTONOMOUS по паспорту | FULL в области A6 |
| `agent.manage` | AUTONOMOUS, только эфемерный анализ | AUTONOMOUS, только эфемерный анализ | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |
| `prompt.temporary` | DENY | AUTONOMOUS, только эфемерный анализ | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |
| `prompt.permanent` | DENY | DENY | CONFIRM | CONFIRM | CONFIRM | CONFIRM | FULL |
| `strategy.change` | DENY, разрешён черновик | DENY, разрешён черновик | CONFIRM | CONFIRM | CONFIRM | CONFIRM | FULL |
| `sandbox.experiment` | DENY | SCOPED | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | AUTONOMOUS | FULL |

Конституция и постоянный промпт Менеджера не являются `prompt.permanent`: работающая система не может менять их ни на одном уровне.

## 6. Составное действие

Перед исполнением действие раскладывается на атомарные способности. Policy Engine проверяет каждую способность и возвращает единый verdict:

- `ALLOW` — все способности разрешены;
- `ALLOW_WITH_LIMITS` — разрешено внутри точного scope;
- `NEEDS_CONFIRMATION` — хотя бы одна способность требует подтверждения;
- `DENY` — хотя бы одна способность запрещена и не имеет override;
- `PAUSE` — действие временно заблокировано риском или отзывом разрешения.

Используется наиболее строгий verdict **между затронутыми категориями**, а не между историческими уровнями одной категории.

## 7. Временный override

Владелец может подтвердить отдельное действие выше текущего профиля. Override:

- относится к конкретной способности, объекту и цели;
- имеет срок, лимит и число использований;
- не повышает остальные способности;
- не превращает чистый профиль в A6;
- журналируется и автоматически прекращается после использования или срока.

## 8. Гибридный профиль

Владелец может назначить разные уровни разным способностям. Интерфейс показывает итоговую матрицу, а не одно вводящее в заблуждение число. Название «A5-проект» допустимо только как базовый профиль с перечисленными overrides.

## 9. Приоритет

1. применимый закон;
2. неизменяемая Конституция и системное ядро;
3. аварийная остановка и активный запрет владельца;
4. подтверждённый capability profile и overrides;
5. паспорт проекта, кампания, бюджет и Permission Contract;
6. промпт Менеджера;
7. промпт агента;
8. текущая задача и данные.

Нижестоящий слой не расширяет полномочия верхнего.

## 10. Нормативный словарь

- **Задача** — ограниченная цель с ожидаемым результатом и критериями готовности.
- **Действие** — намерение пользователя или Менеджера, которое до исполнения раскладывается на операции.
- **Операция** — атомарный исполняемый шаг с уникальным `operation_id`.
- **Кампания** — набор внешних действий с общей целью, аудиторией, каналами, сроком и коммерческими диапазонами.
- **Проект** — долговременная область с отдельными памятью, паспортом, участниками и жизненным циклом.
- **Паспорт проекта** — утверждённый набор цели, KPI, стратегии, рынков, данных, бюджета, сроков и правил выпуска.
- **Способность** — каноническая категория полномочия с постоянным ID из раздела 3.
- **Профиль** — набор режимов всех способностей для чата или проекта.
- **Мандат** — ограниченное во времени право Менеджера действовать по профилю и паспорту.
- **Разрешение** — записанный `Permission Contract` для конкретного scope.
- **Override** — временное точечное расширение одной способности, не меняющее базовый профиль.
- **Verdict** — машинно проверяемое решение Policy Engine перед исполнением.

Текстовые уточнения в ячейках матрицы сужают объект или условие режима, но не создают новый режим. В JSON-контракте они представляются отдельными полями `scope`, `conditions` и `transition`.
