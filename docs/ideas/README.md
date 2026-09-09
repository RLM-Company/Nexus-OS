# Cosmora — архив продуктовых идей

> Статус архива: `NON-AUTHORITATIVE`  
> Назначение: сохранять продуктовые и архитектурные идеи владельца, не превращая их автоматически в требования, permissions или runtime contracts.

## Главное правило

Материал из `docs/ideas/` влияет на продукт только после отдельного переноса в утверждённую спецификацию, constitution/contract, roadmap или проверенную реализацию.

При конфликте приоритет такой:

1. действующие contracts и код `main`;
2. утверждённые constitution/ADR/roadmap документы;
3. dated handoff с явно зафиксированным owner decision;
4. этот архив идей.

## Статусы

- `IDEA` — сохранено без проработки;
- `DISCOVERY` — требует исследования/интервью;
- `DEFERRED` — намеренно отложено;
- `PARTIALLY_IMPLEMENTED` — часть идеи уже отражена в коде/contracts, но исходная идея шире;
- `IMPLEMENTED` — полностью реализовано и проверено;
- `REJECTED` — решение отклонено, запись оставлена для истории.

## Миграция из старого Synmetis archive

Старый draft PR #8 был создан до ребрендинга Synmetis → Cosmora и до значительной части Policy Runtime / Manager Runtime / Control Center. Он не должен merge'иться напрямую. Ниже сохранены и переоценены его идеи на актуальном архитектурном фоне.

## Записи

- [A6 и экспериментальная AI-песочница](./2026-08-22-a6-and-experimental-sandbox.md) — `PARTIALLY_IMPLEMENTED / DISCOVERY`
- [Гипотеза базовой подписки 990 ₽](./2026-08-22-basic-subscription-990.md) — `DEFERRED`
- [Project checkpoints и Decision Trace](./2026-08-23-project-checkpoints-and-decision-trace.md) — `PARTIALLY_IMPLEMENTED`
- [Многоуровневая project memory](./2026-08-23-tiered-project-memory.md) — `DISCOVERY`
- [Обучение моделей на project memory](./2026-08-23-model-training-from-project-memory.md) — `DEFERRED / PRIVACY REVIEW REQUIRED`

## Что сюда не складывать

Не хранить здесь:

- API keys, secrets, credentials;
- финальные system prompts;
- разрешения на реальные external/finance/production effects;
- временные CI/debug инструкции;
- решения, которые уже стали canonical contract — для них нужна ссылка на canonical документ, а не дублирование правил здесь.
