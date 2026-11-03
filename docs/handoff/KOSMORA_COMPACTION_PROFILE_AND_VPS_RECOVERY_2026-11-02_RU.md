# Сжатие по темам и изменениям, разрешение противоречий кандидатов профиля и перенос истории чатов на VPS

Дата: `2026-11-02`
Ветка: `feature/kosmora-compaction-profile-and-vps-recovery-20261102`
Связанные PR стека: `#417`, `#418`, `#419`, `#422`, `#423`, `#424`

## 1. Назначение блока

Этот блок закрывает оставшиеся пункты из `docs/product/KOSMORA_MEMORY_2026-10-30_RU.md`, `docs/handoff/KOSWORK_HISTORY_COMPACTION_2026-10-30_RU.md` (`#418`), `docs/handoff/KOSWORK_PROFILE_CANDIDATES_2026-10-31_RU.md` (`#419`) и `codex/vps-runtime-20261101` (`#423`):

1. **Сжатие истории по темам и изменениям, восстановление подробностей и измерение потерь (`packages/db/src/history-compaction-topic-analyzer.ts`):**
   - Кластеризация старых сообщений диалога по тематическим капсулам (`budget_and_limits`, `architecture_and_storage`, `schedule_and_deadlines`, `security_and_privacy`, `ui_and_frozen_visuals`, `general_context`).
   - Отслеживание хронологических цепочек изменений параметров (`TopicChangeEvent`, например изменение лимита окна `28000 -> 1050000` токенов): устаревшие утверждения переводятся в `supersededSpans` со ссылкой `supersededByMessageId`, чтобы актуальный промпт не получал устаревшие лимиты, но сохранял историю изменений.
   - Количественное измерение точности и потерь (`measureCompactionFidelity`): проверяется `mandatoryConstraintRetentionRate` (при `< 1.0` отправка блокируется с `state = "blocked"`, `reason = "protected_budget"`), `numericAndDateEntityRetentionRate`, `topicCoverageRate` и `semanticLossScore`.
   - Восстановление подробностей (`restoreCompactedTopicDetails`): по любой тематической капсуле возвращаются исходные сообщения из `general_chat_messages` с криптографической сверкой SHA-256 всех сохранённых цитат.

2. **Извлечение фактов с разрешением противоречий, продвижением в профиль и исключениями от повторного запоминания (`packages/db/src/profile-candidate-reconciler.ts`):**
   - Расширенный отбор `semantic-owner-quotes-v2` с соблюдением лимитов `#419` (`<= 200` сообщений, `<= 16 000` символов, строка `8–1000` символов, `<= 8` строк из сообщения, `<= 30` кандидатов, `<= 5` похожих пар, `<= 5000` отпечатков исключений).
   - Детекция дубликатов (`duplicateOfEntryId`) и **противоречий (`contradictsEntryId`, `contradictionReason`)** при расхождении численных лимитов/дат или полярности («не использовать» против «использовать») относительно существующих записей `context_memory_entries`.
   - Атомарное продвижение кандидата в личный профиль (`promoteCandidateToProfile`) с разрешением конфликта (`replace_existing` с инкрементом версии в `context_memory_versions` или `keep_both`).
   - Удаление воспоминания с исключением повторного авто-извлечения (`deleteMemoryWithAutoExtractException`): сохраняет только SHA-256 отпечаток и ссылку на сообщение в `profile_candidate_dismissals` (без хранения отвергнутого текста), **оставляя исходное сообщение в `general_chat_messages` нетронутым для разрешённого поиска**.

3. **Пакетный перенос и восстановление истории чатов для нового VPS (1 vCPU / 1 GB RAM) и диагностика внешней связности (`packages/db/src/vps-chat-history-migrator.ts`, `scripts/vps-chat-recovery-and-tls-probe.mjs`):**
   - Потоковая выгрузка и идемпотентное восстановление (`exportOwnerHistoryBundle` / `restoreOwnerHistoryBundle`) таблиц `general_chats`, `general_chat_runs`, `general_chat_messages` и `context_memory_entries` малыми батчами (`<= 150–250` строк на транзакцию) с проверкой SHA-256 каждого батча и общего манифеста без перегрузки памяти 1 GB RAM VPS.
   - Оценщик внешней связности `evaluateVpsConnectivityProbeResult` для `#423`, корректно разделяющий падение внутреннего runtime и внешнюю фильтрацию TCP-пакетов от облачного раннера Azure `westus2`.

## 2. Проверенные сценарии

Запуск `node scripts/integration-compaction-profile-and-vps-smoke.mjs`:
- `apps/api/test/memory-compaction-and-profile-reconciler.test.ts` — `3/3 PASS`:
  1. Сжатие по темам, фиксация смены лимита `28000 -> 1050000`, фильтрация секретов, `0%` потерь обязательных ограничений, блокировка при нехватке бюджета `protected_budget` и восстановление исходных сообщений с проверкой SHA-256.
  2. Обнаружение противоречия (`1500 рублей` против `3500 рублей`), продвижение в профиль с обновлением версии до `v2`, удаление записи с занесением отпечатка в `profile_candidate_dismissals` и сохранностью исходного чата.
  3. Пакетный экспорт/импорт чатов, запусков, сообщений и памяти между двумя экземплярами SQLite с проверкой SHA-256 манифеста и идемпотентным повторным прогоном.
