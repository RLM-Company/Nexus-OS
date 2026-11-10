# INTEGRATION — 08_FREE_BUILDERS

Второй коммит `c711591bc280128e951332510a225a8ebd4d0abf` касается **общего** `apps/web/src/app/canvas-editor/canvas-editor.tsx` ровно одной строкой:
```tsx
baselineContent={loaded?.revision.content ?? initialDraft?.content ?? ""}
```
Она передаёт дочернему `GameSourceEditor` сохранённую серверную базу сравнения или исходный seed. Никаких регистраций DB, общих API-контрактов, auth, work-cycle, навигации, Canvas хранения или политики сохранения не меняет.

Codex: проверь, что источник `loaded.revision.content` соответствует выбранному artifact и snapshot выбранной версии; пропуск baseline допустим для проекта без валидного source. Включать вместе с изменением `game-source-editor.tsx`, отдельно это может сломать typecheck требуемого prop. Никакой auto-merge.

Запрос на будущую интеграцию, **не реализовано**: типизированная адресная Work/Coscode итерация с `project_id`, `artifact_id`, `expected_version`, выбранным файлом, bounded diff и явным accept; конфликт должен fail closed без перезаписи вручную изменённых файлов. Adapter/contract и DB принадлежит Codex, runtime executor не копировать.
