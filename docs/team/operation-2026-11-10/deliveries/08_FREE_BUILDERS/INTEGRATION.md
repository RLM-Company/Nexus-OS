# INTEGRATION — 08_FREE_BUILDERS

Второй коммит `c711591bc280128e951332510a225a8ebd4d0abf` касается **общего** `apps/web/src/app/canvas-editor/canvas-editor.tsx` ровно одной строкой:

```tsx
baselineContent={loaded?.revision.content ?? initialDraft?.content ?? ""}
```

Она передаёт дочернему `GameSourceEditor` сохранённую серверную базу сравнения или исходный seed. Никаких регистраций DB, общих API-контрактов, auth, work-cycle, навигации, Canvas хранения или политики сохранения не меняет.

Codex: проверь, что источник `loaded.revision.content` соответствует выбранному artifact и snapshot выбранной версии; пропуск baseline допустим для проекта без валидного source. Включать вместе с изменением `game-source-editor.tsx`, отдельно это может сломать typecheck требуемого prop. Никакой auto-merge.

Запрос на будущую интеграцию, **не реализовано**: типизированная адресная Work/Coscode итерация с `project_id`, `artifact_id`, `expected_version`, выбранным файлом, bounded diff и явным accept; конфликт должен fail closed без перезаписи вручную изменённых файлов. Adapter/contract и DB принадлежит Codex, runtime executor не копировать.

## Дополнительный scoped callback (отдельный integration commit)

`854274ef6847a261f7a42f3608069ba0e26d6d4e` добавляет в тот же общий Canvas **опциональный** `onDirtyChange?: (dirty: boolean) => void`. Сигнал сообщается через `useEffect` на изменение локального состояния черновика. Он не отправляет исходники и не меняет server storage, auth или ownership. Единственный потребитель — SitesWorkbench, который предупреждает о несохранённом тексте перед переключением project/work seed. React `setSeed` для того же storageId больше не выполняется.
Проверка: в Canvas не изменяются сохранение/история/конфликт; Codex должен включать callback вместе с SitesWorkbench (отдельно может быть typecheck error), затем подтвердить E2E.

## Приёмка интеграционного адаптера

- Commit `bc6e1b47bbea9895fb1632d5888d47a56d1b0e36` передаёт `onDirtyChange` только если callback существует: `{...(onDirtyChange ? { onDirtyChange } : {})}`; это требуется при `exactOptionalPropertyTypes: true` и не меняет поведение других Canvas callers.
- Код и регрессионные тесты на `606ed1eb876073745cad941d688bf067b3de7e9f` прошли GitHub Actions `42879624872` полностью: quality/build, sandbox isolation и Playwright Chromium (424 + 3 + 5 + 4 pass). Отчётный коммит, если новый, не изменяет приложение.
- Ревью Codex обязательно до merge. Исходники/ассеты/zip версионируются текущим Canvas, тесты используют fixtures; live paid model и публикация не запускались.
