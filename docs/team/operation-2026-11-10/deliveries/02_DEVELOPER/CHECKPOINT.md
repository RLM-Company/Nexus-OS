# CHECKPOINT 02_DEVELOPER

11 ноября 2026, Москва. Branch ops/developer-coscode. PR507 merged интегратором;
дальнейшая работа PR519. BASE1b87dba9e85162fb49729038e0e072e2001609ce.
Code HEADd8290f689099ad86e9e4c1198a887dffc25d68ee,
tree36115719b38a02fcdc74c0fd80020bf77ea6652d, совпадают с GitHub.
Срез review parent CAS + explicit checkpoint load готов к интеграции:
API64PASS, coreexit0(freshAPI1001/web290), production24PASS/exit0.
Временная файловая SQLite: stop service, independent connection/recover/read,
exact edits/proof/token сохранены; API runner synthetic, реальная модель не вызывалась.
Первые lint/coreexit1 и browser22/1 сохранены, причины исправлены, не скрыты.
Пять прежних срезов уже в main через PR507; live-приёмкой это не считается.

Немедленно следующий срез: truncated GitHub tree. Подготовлены (не применены)
/tmp/coscode-tree-adapter.patch и /tmp/coscode-tree-tests-next.ts. Если /tmp потерян:
реализовать optional GithubReadScope(signal/allowed) в существующем adapter,
nonrecursive SHA traversal только после truncated recursive response;128tree nodes,
100k expanded entries,8MB expanded index,30swhole deadline; invalid SHA/name/duplicate/
ancestor-cycle reject; shared subtree под разными prefixes разрешён. При budget или
truncated child вернуть исходный truncated=true result, не partial-as-complete.
Scope проверить до/после request и при чтении body; prepare/file/status/branchTree
принимают scope; Code service использует existing authorityChecks/current active
controller (не второй permissions runtime). Common file отдельным integration commit.
Проверить service create→read→proposal→review/check на recovered tree, secret paths,
отмену/отзыв, limits. Пока это план/patch, не completed функция.

После этого history navigation guard в собственном hook: Navigation API traverse
можно отменить только при event.cancelable и sameDocument; не monkeypatch history.
MDN navigate_event и WHATWG nav-history-apis прочитаны (11 ноября). Общая shell
навигация/стили не принадлежат нам; не переписывать. Bounded model repair ещё не
реализован: существующие manual edits/retry checks сохранить, без hidden paid retry.
Live target publish требует отдельного разрешения; модель/API fixtures только.
Merge/deploy/ПК владельца/VPS не выполнять. Отчёты только02_DEVELOPER.
