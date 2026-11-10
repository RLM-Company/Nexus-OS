# CHECKPOINT 02_DEVELOPER

10 ноября 2026, Москва. Branch ops/developer-coscode, PR #507.
Контрольная база 9d972e8, фактический main BASE f9eb45285f3473bfd3fe9a73939c1903dc696b3b.
Текущий проверенный code HEAD 5a5e2e4d3c5cd04c2556c2d065a0cdf8dd8ff62b;
code tree faf27b8017d0e91a6fdc06a2a11f64a5a67c5920. Docs head — в PR.

Готово к интеграции:

1. Source89ec737 + integration fcc183d: строгие exit/cleanup/journal proofs,
   безопасная отмена setup OCI; реальный tmp Git двух файлов, ошибочный и
   исправленный snapshot, stale conflict, отмена/cleanup. Frozen core exit0:
   свежие API986/web290/runtime71 +5 opt-in skips; прочее cache replay.
   Code head fcc183d внешний OCI5/5. Локальный последний OCI4/5 из-за одного
   старого 5s setup timeout сохранён. Full receipts в DELIVERY/fixtures.
2. Source5a5e2e4: guard несохранённых edits и raw diff; локальный raw discard,
   прежний review checkpoint восстанавливает выбранные bytes. Production UI15PASS,
   web lint/typecheck/build и strict E2E types прошли. Ошибки fixtures/пояснения
   сохранены; ложный продуктовый AbortController-код удалён.

Точная следующая задача: apps/web/src/app/code-agent/page.tsx initial project-load
handler выбирает linked run только из последних20, иначе молча list.items[0].
Сначала добавить воспроизводимый сценарий для старого deep link; затем exact GET
по run ID через текущую owner/project-bound route. При404 не открывать другую задачу.
Late result после смены project игнорировать. После среза: type/lint/browser,
source/docs commits, обновить этот PR без merge. Пока это finding по коду, не test PASS.

Глобальная SPA sidebar/router/back-forward защита не внедрена: common navigation
принадлежит Codex. Наш guard действует в контролах Coscode + native unload.
Repo context/secret paths и bounded feedback repair ещё в backlog. Полная сфера
не завершена, статус максимум готово к интеграции; дальнейшие статусы — Codex.

Не запускать реальную модель/foreign publish/owner PC/VPS/merge/deploy. Не трогать
Office, browser/CDP, work runtime, Games/Sites, chat/sidebar/styles. Перед продолжением
проверить main/common contracts, чужие изменения не сбрасывать. Отчёты писать только
в deliveries/02_DEVELOPER, общую доску не менять.
