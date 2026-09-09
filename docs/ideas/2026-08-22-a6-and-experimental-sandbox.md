# A6 и экспериментальная AI-песочница

**Исходная дата идеи:** 2026-08-22  
**Текущий статус:** `PARTIALLY_IMPLEMENTED / DISCOVERY`

## Исходная идея

В старом Synmetis archive были объединены две связанные, но разные темы:

1. максимальный уровень автономности A6 с гранулярным управлением полномочиями;
2. отдельная экспериментальная AI-песочница для безопасных экспериментов.

## Что уже стало отдельным canonical направлением

A0–A6, гранты, point overrides, step-up и server-side Policy Engine больше не являются просто идеей архива. Их актуальные правила должны читаться из contracts/constitution и текущего кода, а не из этой записи.

Особенно важно: A6 не является bypass-режимом. Максимальная автономность не отменяет hard security boundaries, Emergency Stop, audit, project isolation или обязательный server-side step-up.

## Что остаётся идеей

Экспериментальная AI-песочница всё ещё требует отдельной спецификации:

- какая именно изоляция нужна;
- какие model/tool capabilities доступны внутри sandbox;
- как ограничиваются сеть, файловая система, стоимость и время;
- какие данные проекта разрешено импортировать;
- что можно экспортировать обратно;
- как sandbox связан с A0–A6 и project mandate;
- какие результаты считаются inert artifacts, а какие могут стать реальными actions.

## Неявные запреты

Песочница не должна становиться способом:

- обойти Policy Engine;
- получить A6 без step-up;
- выполнить production/finance/external effect под видом эксперимента;
- снять project/data isolation;
- скрыть действие от Decision Trace.

## Условие перехода в roadmap

Нужна отдельная sandbox threat model + capability matrix + resource limits + explicit export boundary. До этого запись остаётся `DISCOVERY`.
