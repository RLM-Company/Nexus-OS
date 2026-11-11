# CHECKPOINT 02_DEVELOPER

11 ноября 2026, Москва. Branch ops/developer-coscode, PR519. PR507 merged.
Main d047ce125f623c64d2615a6235dfdcd1c8e70a55 просмотрен/принят merge4a6b9cf.
Latest code39cad6b69c1771f78c78908c4183b4c6af885e4e,
treee73b1ab02e899f64105d8fbb6ab9bb4fed53a920. Integrationb22b4f3 отдельно.
Шестой срез CAS/checkpoint: sources7367678/d8290f6, file SQLite recovery,
coreexit0/base1b87dba, UI24PASS. Docs c75de0d. Готов к интеграции.
Седьмой: full bounded tree recovery + service authority binding, scoped100PASS,
lint/types/formatPASS. Fullcoreexit1 на incoming docs/research/experience-llm-distill-
2026-11-10.json. НЕ форматировать чужой artifact/ignore. Все remaining gates exit0,
полный stdout /tmp/coscode-tree-remaining-gates.log и profile отдельным логом;
freshAPI1014/web290/runtime86/core389/DB214/contracts206/gateway151/policy43,
config17cache. В fixtures/tree-recovery сохранены failure/actual exits/hash.
Финальный docs HEAD — в PR. Не выдавать remaining PASS за core PASS.

Следующее: Navigation API guard в own editor-navigation.ts для cancelable
sameDocument navigate(traverse) с другим pathname/search. Native beforeunload и
own Link onNavigate сохранить, history.pushState/router не monkeypatch. MDN
navigate_event (BaselineJan2026,lastmodifiedOct26) и WHATWG nav-history-apis
прочитаны. Test: initial clean Code→NextLink GitHub→Back Code, create/edit, Forward
cancel сохраняет URL/text, Forward accept уходит. Подтвердить NavigationHistoryEntry
sameDocument=true, иначе это лишь native unload тест. Старые браузеры без API и
uncancelable platform traversal честно ограничены. Ни sidebar/layout/CSS не менять.

Затем explicit bounded repair: существующий model(), exact edits, ownerBudget,
check/autoCheckProposal/store использовать повторно. Не второй runtime/chat/store.
Проектирование (ещё не код): одна одобренная модельная попытка на task после
реального failed exit>0+cleanupVerified с known check_type; стабильный request UUID,
server reservation до dispatch, duplicate/timeout не создают второй call. Working
files = original snapshot + current reviewed edits; model only exact edits against
working bytes; final proposal before/diff относительно original snapshot, прочие
owner edits сохранять. Очистить старые draft/check/token атомарно при новом proposal,
сохранить source draft/check provenance; auto recheck тем же разрешённым check,
новый review/approve до publish. UI явное согласие на дополнительную модельную
попытку и check; quota/provider не менять. Тесты fixtures, real API не вызывать.

Доп. найденный race для проверки: initial model tool-only response может вернуть
calls без text.delta; model() live checks на text.delta, authorityChecks удаляются
после guarded callback. Проверить revoke на provider dispatch + single propose_patch
ответ (только уже прочитанный src/add.js). Если подтверждается, scoped wrapper
await model(); live(current,signal) ВНУТРИ guarded callback перед возвратом результата.
Так usage ledger уже завершён model(), а политика проверяется до принятия proposal;
не добавлять общий postflight после необратимого publish. Этот фикс ещё не применён.

Свежий main проверять перед следующим срезом. Полная сфера не завершена.
Live model/foreign publish/ПК владельца/VPS/merge/deploy не выполнять.
Отчёты только02_DEVELOPER; shared adapter отдельный integration commit.
