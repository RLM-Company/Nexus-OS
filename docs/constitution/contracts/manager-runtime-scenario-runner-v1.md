# Manager Runtime Scenario Runner v1

> Статус: `DETERMINISTIC RELEASE-GATE HARNESS / NO RUNTIME AUTHORITY`  
> Дата: `2026-08-31`

## Назначение

Runner превращает machine-readable Step 6 scenarios в однозначный `PASS` или `FAIL` по уже полученным наблюдениям.

Он намеренно не запускает Manager, модели, инструменты, провайдеры или внешние действия и не создаёт evidence самостоятельно.

## Вход

`runManagerRuntimeScenario` принимает:

- один `ManagerRuntimeScenario`;
- массив типизированных `ScenarioObservation`;
- `evaluatedAt`, переданный вызывающей стороной.

Observation поддерживает те же проверяемые поверхности, что и scenario assertions:

- policy verdict;
- task state;
- runtime state;
- artifact visibility;
- operation effect count;
- critic pause scope;
- route group.

## Fail-closed matching

Каждый assertion получает стабильный ключ из собственного типа и объекта проверки.

Для каждого обязательного assertion:

- ровно одно совпавшее observation и правильное значение → `PASS`;
- observation отсутствует → `FAIL`;
- совпало больше одного observation → `FAIL` как неоднозначное свидетельство;
- значение отличается → `FAIL`.

Нерелевантное observation не может закрыть другой assertion только потому, что имеет похожий тип.

## Результат

`ManagerRuntimeScenarioGateResult` содержит:

- `scenario_id`;
- общий `PASS | FAIL`;
- отдельный check по каждому assertion;
- expected/actual summary;
- короткую причину ошибки без скрытого chain-of-thought;
- timestamp оценки.

## Граница полномочий

Runner — pure evaluation layer. Он не имеет API для:

- выдачи permission;
- изменения A0–A6;
- подтверждения owner actions;
- activation агента;
- вызова Tool Runtime;
- изменения checkpoint;
- выбора model/provider;
- записи project memory.

Поздние fixture adapters должны только преобразовывать наблюдаемое состояние соответствующего subsystem в `ScenarioObservation`. Любое фактическое действие остаётся за тем subsystem и его Policy Runtime boundary.
