# Koswork: принятие результата владельцем — поставка

- **Ветка:** `deepseek/koswork-result-acceptance`
- **База:** `338536ee5946f96dcd18768143cc41af998c476a`
- **Согласованный объём:** `docs/product/KOSWORK_FIRST_TASK_RESULT_PROPOSAL_RU.md`
- **Владелец реализации:** DeepSeek
- **Синхронизация:** 9 ноября в ветку влит актуальный `origin/main`
  (`7bb246bef2ed8e9f47ae93260384e560a9d6065c`, 18 коммитов после базы).
  `main` менял `manager-work-routes.ts`, `manager-work-store.ts` и
  `manager-work.test.ts`; конфликтов при слиянии не было, `acceptResult`,
  маршрут и тесты сохранились. Проверено: `manager-work.test.ts` 70 passed,
  `manager-work-result-acceptance.test.ts` 3 passed.

## Что было

К 8 ноября раздел «первая полная задача» уже работал: план, этапы, публикация
файлов и отмена в `ManagerWork`; в Windows-цикле Koswork принятие результата
существовало (`desktop/windows/work-experience.cjs`, `acceptedAt`,
`outcome: "owner_accepted"`).

В API/Web-поверхности (`manager-work-routes.ts`) принятия результата не было:
`control` принимал только `pause | resume | approve | cancel`, где `approve`
относится к плану сложной задачи. `ManagerWork` не содержал полей принятия.
То есть задача завершалась статусом `completed`, но отдельного действия
«владелец принял результат» в истории API-пути не существовало.

## Что работает теперь

1. **`ManagerWorkStore.acceptResult(id, ownerId, actorId, expectedVersion)`**
   - принимает только `status = "completed"` и `stage = "done"`, иначе
     `WORK_RESULT_NOT_READY`;
   - обязательный `expectedVersion` (CAS): устаревшая версия → `STALE_WORK`;
   - повторное принятие возвращает сохранённую запись **без** новой версии,
     события и без изменения автора/времени;
   - `assertWritable` сохраняет прежние границы: `OWNER_DATA_FENCED`,
     `OWNER_QUIESCED`;
   - файлы не меняются, повторной публикации нет, наружу ничего не отправляется.
2. **`POST /api/v1/projects/:projectId/work/:id/result/accept`**
   тело `{ expected_version }`; ответ — обновлённая работа. Коды:
   `404 WORK_NOT_FOUND`, `409 WORK_RESULT_NOT_READY | STALE_WORK`, `400` при
   неверном теле. Маршрут зарегистрирован существующим
   `registerManagerWorkRoutes` (вызывается из `apps/api/src/app.ts`).
3. **Поля контракта** `result_accepted_at`, `result_accepted_by` (опциональные,
   поэтому старые записи `state_json` читаются без миграции).
4. **Интерфейс**: в существующем экране работы у завершённой задачи появилась
   кнопка «Принять результат»; после принятия — строка
   «Результат принят владельцем <дата>». Сайдбар, чат, логотип и палитра
   не менялись.
5. **Приватность**: экспорт владельца уже читает `SELECT * FROM manager_work`,
   поэтому новые поля попадают в выгрузку без отдельного адаптера; удаление
   владельца удаляет строку целиком, осиротевших ссылок нет.

## Изменённые файлы

| Файл                                                      | Изменение                   |
| --------------------------------------------------------- | --------------------------- |
| `packages/contracts/src/manager-work.ts`                  | +2 поля принятия результата |
| `packages/db/src/manager-work-store.ts`                   | +`acceptResult`             |
| `packages/db/test/manager-work-result-acceptance.test.ts` | новый тест, 3 сценария      |
| `apps/api/src/manager-work-routes.ts`                     | +маршрут `result/accept`    |
| `apps/api/test/manager-work.test.ts`                      | +1 HTTP-тест                |
| `apps/web/src/app/manager-work-panel.tsx`                 | +кнопка и строка состояния  |
| `docs/product/KOSWORK_FIRST_TASK_RESULT_PROPOSAL_RU.md`   | согласованное предложение   |

**Миграций нет.** Состояние задачи хранится в `state_json`, схема таблицы
`manager_work` не менялась — конфликтов номеров миграций при объединении нет.

## Проверки

```powershell
cd packages/db && node .../vitest.mjs run test/manager-work-result-acceptance.test.ts
# → 3 passed

cd apps/api && node .../vitest.mjs run test/manager-work.test.ts test/work-dag.test.ts
# → 106 passed (66 + 40)

node <pnpm.mjs> --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api typecheck
# → Done

node <pnpm.mjs> --filter @cosmora/contracts --filter @cosmora/db --filter @cosmora/api --filter @cosmora/web lint
# → Done

node <pnpm.mjs> --filter @cosmora/web typecheck
# → Done
```

Проверено поведение: отказ до завершения, успешное принятие, идемпотентный
повтор без второй версии и события, устаревшая версия, чужой владелец,
privacy-fence, неверное тело запроса.

## Ограничения

- **Живая приёмка не выполнялась.** Контрольная задача владельца
  (поиск → Word-отчёт с источниками → сохранение на рабочем столе) требует
  восстановленного VPS и установленного клиента 0.16.0; в этом прогоне модель,
  Word и рабочий стол не задействованы.
- Принятие необратимо и не имеет отзыва/повторного открытия: это отдельный
  объём, в согласование не входил.
- Windows-цикл Koswork не изменялся — там своё принятие (`acceptedAt`).
- «Принять результат» не означает проверку семантической правильности: это
  фиксация решения владельца, а не оценка качества моделью.

## Интеграция

```
POST /api/v1/projects/<projectId>/work/<workId>/result/accept
{ "expected_version": 7 }
→ 200 ManagerWork с result_accepted_at / result_accepted_by
```

Прямой вызов из кода:

```ts
store.acceptResult(workId, ownerId, actorId, expectedVersion);
```

## Откат

`git revert <commit>` убирает метод, маршрут, поля, тесты и контрол. Так как
миграций нет, данные не деградируют: лишние поля в `state_json` останутся
инертными и не читаются старым кодом.

## Финальный CI после синхронизации с main

На коммите `47c2d46` (merge `7bb246be`):

```
Verify monorepo     pass  6m11s
Browser acceptance  pass  11m49s
Code sandbox isolation pass
identity-tests      pass
```

Все четыре проверки зелёные.
