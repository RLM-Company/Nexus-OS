# Интерфейсы 06_HARNESS (срез 1 — shared project list)

База: main `3af92583ccc8ceb49f44c0b8633955f40feaf59f`.
Ветка: `feature/ds3-collaboration-connectors-20261127`, изолированный worktree `ds3-collaboration`.

## Функция

`GET /api/v1/projects` для участника возвращает не только его собственные проекты,
но и **принятые** общие проекты с полем `membership_role: viewer | editor`.
Приглашение (`status=invited`) в список не попадает: ссылка не раскрывает данные
до accept. Отзыв/leave убирает проект из списка сразу.

## Входы/выходы

- `ProjectMembershipStore.sharedWith(accountId)` → массив
  `{ id, title, status, updated_at, last_message_preview, membership_role }`.
- `ProjectSummary.membership_role?: "viewer" | "editor" | "owner"` — минимальное
  расширение общего контракта (обратно совместимо).
- `app.ts` — integrate-only изменение: объединяет `store.listProjects(owner)` и
  `membership.sharedWith(owner)`, дедуплицируя по id. `identity.owner_id` не подменяется.

## События и принадлежность данных

- Данные остаются в `projects.owner_id` исходного владельца; у участника только
  роль в `project_members`.
- Никаких новых миграций: используется таблица `project_members` из #688.
- Запись/изменение общих материалов инициируется от identity участника;
  `projectAccess()` поставки #688 остаётся точкойCII выбора owner data.

## Проверено

- `packages/db test/project-membership-store.test.ts` — 4 passed (новый тест: до accept пусто, после accept роль editor, после revoke пусто).
- `apps/api test/project-membership.test.ts` — 3 passed (новый тест: список участника через HTTP, viewer, revoke).
- typecheck contracts/db/api — 0.

## Границы

Не менял sidebar, общий UI, RBAC #688,连接器 и чужие зоны. Живые аккаунты и VPS не использовались.
