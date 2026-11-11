# CHECKPOINT 02_DEVELOPER

11 ноября 2026, Москва. Branch ops/developer-coscode, PR #507.
BASE последнего среза b457cf9655d2c8001249c9c34e0180dcc58d97de.
Main4b74f2694d6281887cecdccddaeff994549ec8f0 сохранён этим merge (последнее
продвижение — только канонические отчёты). Контрольный9d972e8 остаётся предком.
Code HEAD4eb1b83ccd3f16aa79a4de6cfd8fa063b053fb81,
treef99c5cd4c85c3546cc21c1c6d4dfd6d1ba995b3e. Финальный docs HEAD — в PR.

Поставки (не присваивать статус выше готово к интеграции):

1. Source89ec737/integrationfcc183d: executor proof и OCI cancel/setup,
   настоящий tmp Git2файла, failure/success/stale/cancel, точный diff/receipt.
2. Source5a5e2e4: unsaved/raw-diff guards и review checkpoint restoration.
3. Source30e1944: exact linked run/project и late callback isolation.
4. Sourced467fdb + fixture0591ed1: полный tree22 002, selective1blob, safe paths,
   legacy-context fence; rootcore exit0 (freshAPI997/web290/runtime86), UI22PASS,
   externalOCI5/5. Первый TS2379 gateexit2 сохранён. Остальное — в DELIVERY.
5. Source4eb1b83: negotiated search_files по immutable безопасному индексу,
   query1–160/result32/partial/count; без нового IO/прав. Scoped71PASS,
   rootcore exit0 (freshAPI999, остальные пакеты cache); externalOCI5/5 на4eb1b83.
   Первый scoped70/1 (не учтён before) и первый gateexit1 no-control-regex
   сохранены и исправлены без отключения проверок. Web этим срезом не менялся;
   предыдущие UI22 не выдаются за повторную browser-приёмку search tool.
   Общие CI Verify/Browser при последнем чтении ещё выполнялись.

Точная следующая приёмка — bounded repair / checkpoint:

- Прочесть текущие CodeAgentService.reviewAccepted/invalidateReview/
  retryProposalCheck/autoCheckProposal/check и соответствующие scoped tests.
- Воспроизвести failure→owner точная правка→новый review/hash→успешный check→
  восстановление той же задачи; проверить, что старый proof/token не вернулся,
  snapshot/base и чужие файлы целы. Существующий retry check бесплатный и не
  запускает модель; это сильное поведение сохранить, второй runtime не создавать.
- Затем выбрать конкретный незавершённый пробел ограниченного ремонта. Не добавлять
  скрытый paid retry, не перезаписывать пользовательские edits. Не заявлять automatic
  repair уже готовым: этот срез дал поиск путей, а не новую repair loop.

Truncated tree по-прежнему отказ: безопасная subtree strategy требует отдельного
GitHub adapter integration с полным existence coverage. Общий SPA sidebar/back-forward
нуждается в каноническом guard Codex. Фильтр путей не доказывает отсутствие секретов
в любом исходнике. Полная сфера не закончена; further status подтверждает Codex.
Live модель/foreign target publish/owner PC/VPS/merge/deploy не выполнялись.
Перед продолжением проверить main/contracts и не сбрасывать чужие изменения.
Office/browser/CDP/work runtime/Games/Sites/chat/sidebar не присваивать; отчёты
писать только в deliveries/02_DEVELOPER, общую доску не редактировать.
