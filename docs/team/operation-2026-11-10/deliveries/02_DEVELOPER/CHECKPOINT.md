# CHECKPOINT 02_DEVELOPER

10 ноября 2026, Москва. Branch ops/developer-coscode, PR #507.
Исходный BASE f9eb45285f3473bfd3fe9a73939c1903dc696b3b, контрольный9d972e8 — предок.
Новый main f9da6e83c8764949d7a478649b8d680517f1c320 просмотрен и принят merge.
HEAD кода 589eb3110c6a123f6dcf612f666269b5bd56468e,
tree870f2aaeb5c7c882e2b919ac5a767c0a7afe6963. Финальный docs head — в PR.

Готово к интеграции:

1. Source89ec737 + integrationfcc183d: строгие exit/cleanup/journal proofs,
   безопасная отмена setup OCI, реальный tmp Git двух файлов с ошибкой/исправлением,
   stale conflict и отменой. Receipt сохранён. ЛокальноOCI4/5 (старый5s timeout),
   внешний CI fcc183d OCI5/5. Не выдавать старые checks за проверки нового HEAD.
2. Source5a5e2e4: guard несохранённых edits/raw diff, явный discard, сохранение
   через существующий review checkpoint. Production15PASS. Только местные контролы
   и native unload; общий sidebar/router/back-forward не интегрирован.
3. Source30e1944: exact linked task/project без fallback, epochs и lifecycle guard
   поздних callbacks редактора. На source web lint/types/build/E2Etypes +22PASS exit0.
   После merge: core exit0 (fresh API992/web290/runtime71/DB205; прочее cache),
   production UI22PASS exit0; CI589eb31 OCI5/5 и Verify monorepo success.
   Общий CI Browser acceptance при последней проверке ещё выполнялся.
   Сбой default browser config до правильного запуска сохранён, exit1.

Точная следующая задача: большой context в apps/api/src/code-agent/service.ts,
метод propose: tree.truncated или >20000 даёт TREE_LIMIT до выборочного чтения.
Сначала прочитать tree/search интерфейсы текущего GitHub adapter и scoped tests,
зафиксировать воспроизводимый large-tree сценарий без секретов. Не вводить второй
runtime, не читать arbitrary paths и не менять общий GitHub client без отдельного
минимального integration commit. Сохранить фиксированный base_sha и owner/project
privacy fences. Параллельно проверить safeCodePath (secret-path исключения), затем
bounded repair/checkpoint сценарии. Объём нового механизма выбрать после обзора.

Полная сфера не завершена, статус максимум готово к интеграции. Дальнейшие статусы
подтверждает Codex. Реальная модель/foreign publish/owner PC/VPS/merge/deploy
не выполнялись и не разрешены. Office/browser/CDP/work runtime/Games/Sites/chat/sidebar
не присваивать. Перед продолжением проверить main и новые общие контракты; отчёты
писать только в deliveries/02_DEVELOPER, общую доску не редактировать.
