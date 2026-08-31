# Manager Runtime Scenario Suite Runner v1

> Статус: `AGGREGATE RELEASE GATE / NO RUNTIME AUTHORITY`  
> Дата: `2026-08-31`  
> Verification target: `main@163683438536fab9d19d260020cc681dec8e78cd`

## Назначение

Этот слой агрегирует одиночные Step 6 scenario gates в один release verdict для конкретного runtime-инкремента.

`runManagerRuntimeScenarioSuite` не генерирует evidence и не запускает subsystem. Он получает полный machine-readable scenario catalog и уже собранные observation sets.

## Алгоритм

1. Полный catalog проверяется `validateManagerRuntimeScenarioCatalog`.
2. Из него выбираются сценарии, где `required_for` содержит `targetIncrement`.
3. Если для increment нет зарегистрированных сценариев, suite fail-closed возвращает `FAIL`.
4. Для каждого required scenario требуется ровно один `ScenarioObservationSet`.
5. Отсутствующий bundle → `FAIL`.
6. Два bundle с одним `scenario_id` → `FAIL` как неоднозначное evidence.
7. Каждый корректно сопоставленный bundle передаётся одиночному `runManagerRuntimeScenario`.
8. Общий `PASS` возможен только если catalog валиден, bundles полны и уникальны, а каждый вложенный scenario имеет `PASS`.

Нерелевантные bundles не влияют на verdict, но записываются в `unused_observation_set_ids`, чтобы evidence input оставался прозрачным.

## Граница полномочий

Suite runner не имеет права:

- запускать Manager/agents/models/tools;
- формировать observations самостоятельно;
- менять Policy verdict;
- подтверждать owner action;
- изменять A0–A6;
- снимать emergency stop или critic block;
- создавать внешний эффект;
- записывать project memory;
- активировать Agent Studio proposals.

И `PASS`, и `FAIL` являются только release-gate результатом. Они не являются командой на запуск runtime. Новые upstream validation layers остаются самостоятельными обязательными границами и не могут считаться пройденными только из-за aggregate `PASS`.
