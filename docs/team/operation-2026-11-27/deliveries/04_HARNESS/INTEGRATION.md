# INTEGRATION — 04_HARNESS

- Общие файлы `apps/api/src/app.ts` и `apps/api/src/server.ts` изменены только
  для регистрации `StarsOrgStore` и передаче его в существующую
  `registerStarsMissionRoutes`. Другой рефакторинг не выполнялся.
- Новая миграция `0078_stars_org_snapshots.sql` исполняема, проверена upgrade
  из состояния после 0077; окончательный номер/время согласует интегратор.
- `StarsOrgStore` и Pure `stars-hierarchy.ts` не дублируют память/Skills
  (Harness 2), права (Harness 3) или device lease (OpenCode 1).
- Stars page читает org API; новый UI не трогает sidebar/chat/global CSS.
- Перед финальной сдачей должны быть подключены delegation в WorkDAG,
  handoff/checkpoint, context scope, event wait, senior review и remote boundary.
