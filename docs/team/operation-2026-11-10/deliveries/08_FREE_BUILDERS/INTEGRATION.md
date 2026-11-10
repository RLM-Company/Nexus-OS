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
