# ПОЛНЫЙ МАНИФЕСТ И КАТАЛОГ РАЗРАБОТКИ KOSMORA / KOSWORK ЗА 3 ДНЯ (WAVES 1–26, PR #411–#428)

- **Дата сборки единого пакета**: `2026-11-03`
- **Целевой репозиторий**: `https://github.com/RLM-Company/Nexus-OS`
- **Всего файлов кода, миграций, тестов и документации в репозитории**: `202`
- **Размер единого git-патча (`kosmora-complete-3days-unified.patch`)**: `1,602,196` байт
- **Статус мастер-матрицы верификации (`scripts/stage2-master-verification-matrix-runner.mjs`)**: **25 из 25 тест-сьютов PASS (100%)**
- **Защита границ с параллельной работой Codex**: `0` изменений в `apps/api/src/account-settings/**`, `packages/db/src/usage-store.ts`, `packages/contracts/src/usage.ts`

## Быстрая установка из этого пакета

### Вариант А — Прямая распаковка поверх корня репозитория и пуш одной командой
```bash
unzip -o kosmora-complete-3days-all-in-one-package.zip -d /path/to/Nexus-OS
cd /path/to/Nexus-OS
bash push-all-3days-complete.sh
```

### Вариант Б — Применение через единый Git-патч
```bash
cd /path/to/Nexus-OS
git apply kosmora-complete-3days-unified.patch
node scripts/stage2-master-verification-matrix-runner.mjs
```

## Полный реестр 202 файлов репозитория (с контрольными суммами SHA-256)

| № | Путь файла в репозитории | Размер (байт) | SHA-256 (первые 16 символов) |
| :--- | :--- | :--- | :--- |
| 1 | `apps/api/src/app.ts` | 109,005 | `724bbf42bb74b21a` |
| 2 | `apps/api/src/cloud-storage/full-account-emergency-snapshot.ts` | 9,357 | `ccc045eac80ceade` |
| 3 | `apps/api/src/cloud-storage/google-drive-archive-builder.ts` | 12,776 | `adc4176f249321d5` |
| 4 | `apps/api/src/cloud-storage/google-drive-authorization.ts` | 6,812 | `981f3373735e8081` |
| 5 | `apps/api/src/cloud-storage/google-drive-backups.ts` | 9,673 | `7b4f5cf943848265` |
| 6 | `apps/api/src/cloud-storage/google-drive-controller.ts` | 14,273 | `1fcf9944367d6cea` |
| 7 | `apps/api/src/cloud-storage/google-drive-grant-cipher.ts` | 2,767 | `92cf640c63def3a0` |
| 8 | `apps/api/src/cloud-storage/google-drive-immutable-spooler.ts` | 14,857 | `b7b328770ced59cb` |
| 9 | `apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts` | 21,136 | `0d2659bc75f2faab` |
| 10 | `apps/api/src/cloud-storage/google-drive-privacy.ts` | 2,166 | `08badab18941151b` |
| 11 | `apps/api/src/cloud-storage/google-drive-restore.ts` | 21,441 | `85c4898f6a439307` |
| 12 | `apps/api/src/cloud-storage/google-drive-routes.ts` | 12,139 | `57e4ac7047a9273d` |
| 13 | `apps/api/src/cloud-storage/google-drive-store.ts` | 15,807 | `7dd9349fc97ff301` |
| 14 | `apps/api/src/cloud-storage/google-drive.ts` | 10,445 | `6be728b3c78d8446` |
| 15 | `apps/api/src/cloud-storage/index.ts` | 5,308 | `b5be1de2c171ddf1` |
| 16 | `apps/api/src/context-memory-hybrid-routes.ts` | 4,089 | `26fee6e869b93993` |
| 17 | `apps/api/src/fable-discovery-and-registry-validator.ts` | 3,927 | `b81142becb19e20e` |
| 18 | `apps/api/src/fable-sse-resilient-stream.ts` | 10,055 | `926100e83d86efac` |
| 19 | `apps/api/src/memory-advanced-compaction-routes.ts` | 5,180 | `89b435dc2b8f5941` |
| 20 | `apps/api/src/memory-snapshot-reconciler.ts` | 21,087 | `89f934e7753997d3` |
| 21 | `apps/api/src/server.ts` | 12,652 | `e4f314d2a771e7f3` |
| 22 | `apps/api/src/stage2-privacy-adapter.ts` | 9,464 | `54b652019d674800` |
| 23 | `apps/api/test/cdc-ast-and-bandit-router.test.ts` | 4,690 | `e3e007f10a8040be` |
| 24 | `apps/api/test/context-memory-hybrid-and-migration.test.ts` | 9,298 | `23ac14b5e8c45dfa` |
| 25 | `apps/api/test/crdt-mcts-and-pii-firewall.test.ts` | 5,934 | `d98794e4be351008` |
| 26 | `apps/api/test/cuckoo-shamir-and-causal-engine.test.ts` | 6,137 | `b9540c5ce0936f25` |
| 27 | `apps/api/test/datalog-minhash-and-otel-tracer.test.ts` | 5,735 | `7bded64f7f04bc33` |
| 28 | `apps/api/test/drive-journal-recovery-and-bpe-audit.test.ts` | 6,602 | `779d9b8676df733b` |
| 29 | `apps/api/test/dynamic-budget-and-audit-blackbox.test.ts` | 4,768 | `8105c6c697ed0ba2` |
| 30 | `apps/api/test/fable-sse-memory-cache-and-workflows.test.ts` | 11,148 | `b5bd6d48272ba16c` |
| 31 | `apps/api/test/full-account-emergency-snapshot.test.ts` | 3,580 | `f01788f08e7832c3` |
| 32 | `apps/api/test/google-drive-complete.test.ts` | 29,641 | `72a559275670129c` |
| 33 | `apps/api/test/google-drive-immutable-spooler.test.ts` | 5,849 | `e0f81a0ae167adf2` |
| 34 | `apps/api/test/hnsw-merkle-and-grammar-enforcer.test.ts` | 4,722 | `8a73272a19369d70` |
| 35 | `apps/api/test/memory-compaction-and-profile-reconciler.test.ts` | 10,654 | `0aeb1993b816bd2a` |
| 36 | `apps/api/test/memory-snapshot-reconciler.test.ts` | 9,887 | `ba8638a720dcb9b0` |
| 37 | `apps/api/test/nextgen-vector-caching-consensus.test.ts` | 7,427 | `f6a1b748057cc1f9` |
| 38 | `apps/api/test/pq-kalman-and-zk-verifier.test.ts` | 3,542 | `1456ca0c86be9e6d` |
| 39 | `apps/api/test/reflexion-and-grounding-verifier.test.ts` | 4,336 | `b812e969f4ff0af8` |
| 40 | `apps/api/test/roaring-dp-and-petri-net.test.ts` | 9,407 | `355198cf47a7f838` |
| 41 | `apps/api/test/self-healing-runtime-and-citation-graph.test.ts` | 4,592 | `95c884d5bec5cb11` |
| 42 | `apps/api/test/speculative-tool-router.test.ts` | 6,711 | `77733e87b0d18c5a` |
| 43 | `apps/api/test/stage2-privacy-and-fencing.test.ts` | 5,596 | `69cd1d9f49a9a2dd` |
| 44 | `apps/api/test/temporal-kg-injection-and-circuit-breaker.test.ts` | 6,552 | `af3a22ef25976253` |
| 45 | `apps/api/test/workflow-dag-critic-and-receipts.test.ts` | 5,302 | `8173d4ae68564600` |
| 46 | `apps/api/test/workflow-portability-and-fable-discovery.test.ts` | 6,579 | `8c8be33370acf192` |
| 47 | `apps/web/src/app/personal-settings/google-drive-panel.tsx` | 15,898 | `78d7b7b69608346f` |
| 48 | `apps/web/src/app/personal-settings/page.tsx` | 12,131 | `b03e4811cc157ef6` |
| 49 | `config/model-registry.tokenshop.fable.v1.json` | 1,233 | `a4bb78da21b8ee32` |
| 50 | `deploy/alpha/GOOGLE_DRIVE.md` | 2,638 | `a5d8a4ecdeee26e4` |
| 51 | `deploy/alpha/drive.env.example` | 982 | `f6d7f08fbac9b911` |
| 52 | `desktop/windows/browser/download-verifier.cjs` | 5,723 | `ac3577ff52b8c8af` |
| 53 | `desktop/windows/browser/search-pagination-and-bookmarks.cjs` | 5,744 | `0fd3e5947da7f047` |
| 54 | `desktop/windows/browser/shadow-and-frame-piercer.cjs` | 6,817 | `c4b466dd8943308a` |
| 55 | `desktop/windows/browser/visual-dom-diff-verifier.cjs` | 6,023 | `ded95b6cbaa31e12` |
| 56 | `desktop/windows/ci/archive-quarantine-verifier.cjs` | 6,572 | `63d5f76f038b9895` |
| 57 | `desktop/windows/ci/clipboard-and-drop-guard.cjs` | 5,581 | `239b18fb70b65a6c` |
| 58 | `desktop/windows/ci/computer-hazard-and-focus-guard.cjs` | 7,080 | `c38c2e4640fe3827` |
| 59 | `desktop/windows/ci/desktop-runtime-watchdog.cjs` | 4,523 | `9ec2cb3068533d72` |
| 60 | `desktop/windows/ci/dpi-coordinate-calibrator.cjs` | 5,368 | `4e62f725391434f5` |
| 61 | `desktop/windows/ci/stage2-desktop-ipc-bridge.cjs` | 5,150 | `1e0eb72b625037af` |
| 62 | `desktop/windows/ci/unified-task-coordinator.cjs` | 5,940 | `40ac30b24b89eae8` |
| 63 | `desktop/windows/ci/wav-pcm-audio-verifier.cjs` | 8,652 | `53e93207dc50b66d` |
| 64 | `desktop/windows/test/archive-quarantine-verifier.test.cjs` | 1,700 | `4169a87ecd96d607` |
| 65 | `desktop/windows/test/clipboard-and-drop-guard.test.cjs` | 2,509 | `59653905c90ae5fe` |
| 66 | `desktop/windows/test/computer-hazard-and-focus-guard.test.cjs` | 3,146 | `4fbb45d261751d79` |
| 67 | `desktop/windows/test/desktop-runtime-watchdog.test.cjs` | 2,592 | `5c4aa1b5a5463c3c` |
| 68 | `desktop/windows/test/download-verifier.test.cjs` | 3,181 | `bc0c5f445f4f7bf0` |
| 69 | `desktop/windows/test/dpi-coordinate-calibrator.test.cjs` | 2,206 | `ccdaeebb8f3e3ee4` |
| 70 | `desktop/windows/test/excel-workbook-builder.test.cjs` | 2,670 | `6a9910e0550b0669` |
| 71 | `desktop/windows/test/interactive-report-bundle-builder.test.cjs` | 2,622 | `34a77ad69d7f6aeb` |
| 72 | `desktop/windows/test/koswork-workspace.test.cjs` | 17,776 | `9ff8bd8ee5dcf64b` |
| 73 | `desktop/windows/test/pdf-report-builder.test.cjs` | 1,983 | `d0d070e8a97196fa` |
| 74 | `desktop/windows/test/powerpoint-deck-builder.test.cjs` | 2,193 | `8f2df86ea29dd4da` |
| 75 | `desktop/windows/test/shadow-piercer-and-word-report.test.cjs` | 4,813 | `ac9dfff02fae9d0f` |
| 76 | `desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs` | 3,169 | `953e8864c8ec4e8f` |
| 77 | `desktop/windows/test/unified-task-coordinator.test.cjs` | 2,788 | `aa4f4169495ce4d5` |
| 78 | `desktop/windows/test/vault-bridge-and-search-store.test.cjs` | 5,647 | `0b37fb6efc381720` |
| 79 | `desktop/windows/test/vault-document-extractor.test.cjs` | 9,057 | `29d588b3c4c807df` |
| 80 | `desktop/windows/test/visual-diagram-extractor.test.cjs` | 3,155 | `db4cebff1eb8a52a` |
| 81 | `desktop/windows/test/visual-dom-diff-verifier.test.cjs` | 2,383 | `77784cd4c7d670fa` |
| 82 | `desktop/windows/test/wav-pcm-audio-verifier.test.cjs` | 2,014 | `c4f71f6005d5d9c8` |
| 83 | `desktop/windows/vault-document-extractor.cjs` | 25,698 | `3382d4b1e6e0bae1` |
| 84 | `desktop/windows/vault-virtual-bridge.cjs` | 7,664 | `7d7d3ecd24e302e3` |
| 85 | `desktop/windows/vault-visual-diagram-extractor.cjs` | 5,900 | `626aabfabad61f72` |
| 86 | `desktop/windows/workspace/README.md` | 8,252 | `ee2dd7f472dc1a2b` |
| 87 | `desktop/windows/workspace/demo.cjs` | 9,368 | `2c6cc57c546ea2b1` |
| 88 | `desktop/windows/workspace/errors.cjs` | 2,207 | `e2eed8dc8bbfd19a` |
| 89 | `desktop/windows/workspace/excel-workbook-builder.cjs` | 10,487 | `c3a28cd7799e3008` |
| 90 | `desktop/windows/workspace/index.cjs` | 1,396 | `baf9f3bbc8a9079c` |
| 91 | `desktop/windows/workspace/interactive-report-bundle-builder.cjs` | 7,183 | `57b97dd279f95c53` |
| 92 | `desktop/windows/workspace/path-guard.cjs` | 16,441 | `acbf18e297f7839c` |
| 93 | `desktop/windows/workspace/pdf-report-builder.cjs` | 5,355 | `7995506cdd255ddb` |
| 94 | `desktop/windows/workspace/powerpoint-deck-builder.cjs` | 9,276 | `d176eed78f85588f` |
| 95 | `desktop/windows/workspace/version-backup.cjs` | 12,102 | `d2f2c45d6e526dd5` |
| 96 | `desktop/windows/workspace/word-report-builder.cjs` | 9,059 | `0199e200ed990cd5` |
| 97 | `desktop/windows/workspace/workspace-service.cjs` | 43,045 | `a79886ffb1f7c207` |
| 98 | `desktop/windows/workspace/workspace.test.cjs` | 17,776 | `9ff8bd8ee5dcf64b` |
| 99 | `docs/handoff/KOSMORA_AUTONOMOUS_SELF_HEALING_AND_KNOWLEDGE_GRAPH_2026-11-02_RU.md` | 5,868 | `12257ccb0c135b7b` |
| 100 | `docs/handoff/KOSMORA_CDC_AST_SANDBOX_BANDIT_AND_PDF_BUILDER_2026-11-02_RU.md` | 6,072 | `b48928b271a0aa55` |
| 101 | `docs/handoff/KOSMORA_COMPACTION_PROFILE_AND_VPS_RECOVERY_2026-11-02_RU.md` | 6,625 | `1b7b758be7722007` |
| 102 | `docs/handoff/KOSMORA_CRDT_MCTS_PII_AND_EXCEL_BUILDER_2026-11-02_RU.md` | 5,611 | `bfbc09aa88ad42ca` |
| 103 | `docs/handoff/KOSMORA_CUCKOO_SHAMIR_CAUSAL_AND_HTML_BUNDLE_2026-11-03_RU.md` | 4,349 | `44dc99ce1c4c8910` |
| 104 | `docs/handoff/KOSMORA_DATALOG_MINHASH_OTEL_AND_CLIPBOARD_GUARD_2026-11-03_RU.md` | 5,250 | `3d70523ea657191a` |
| 105 | `docs/handoff/KOSMORA_DRIVE_JOURNAL_RECOVERY_AND_HAZARD_GUARD_2026-11-02_RU.md` | 5,926 | `cb61e3bd7a73b02d` |
| 106 | `docs/handoff/KOSMORA_DRIVE_SPOOL_AND_KOSWORK_UNIFIED_2026-11-02_RU.md` | 4,947 | `d9dea9df51b6f353` |
| 107 | `docs/handoff/KOSMORA_DYNAMIC_BUDGET_AND_AUDIT_BLACKBOX_2026-11-02_RU.md` | 5,893 | `291f2a48695bdc35` |
| 108 | `docs/handoff/KOSMORA_FABLE_SSE_MEMORY_CACHE_AND_WORKFLOW_SCHEDULES_2026-11-02_RU.md` | 5,711 | `5fbba05a9d7cd37f` |
| 109 | `docs/handoff/KOSMORA_GOOGLE_DRIVE_COMPLETE_2026-11-01_RU.md` | 10,150 | `6a47d989a29f08ae` |
| 110 | `docs/handoff/KOSMORA_HNSW_MERKLE_GRAMMAR_AND_DPI_CALIBRATOR_2026-11-02_RU.md` | 5,853 | `031762112d514610` |
| 111 | `docs/handoff/KOSMORA_HYBRID_MEMORY_AND_NOTES_MIGRATION_2026-11-01_RU.md` | 5,738 | `27fb80f3e1769ce5` |
| 112 | `docs/handoff/KOSMORA_NEXTGEN_FRONTIER_TECHNOLOGIES_2026-11-02_RU.md` | 7,504 | `348f5f94c9a41e51` |
| 113 | `docs/handoff/KOSMORA_PPTX_TEMPORAL_KG_AND_SECURITY_SHIELD_2026-11-02_RU.md` | 5,605 | `5997317c816dcca3` |
| 114 | `docs/handoff/KOSMORA_PQ_KALMAN_ZK_AND_ARCHIVE_QUARANTINE_2026-11-03_RU.md` | 2,840 | `c01605001524092d` |
| 115 | `docs/handoff/KOSMORA_REFLEXION_GROUNDING_AND_DOM_DIFF_2026-11-02_RU.md` | 6,166 | `617bec30fa34e7f4` |
| 116 | `docs/handoff/KOSMORA_ROARING_DP_PETRI_AND_WAV_VERIFIER_2026-11-03_RU.md` | 3,928 | `5f2e97a5aa38679d` |
| 117 | `docs/handoff/KOSMORA_SPECULATIVE_ROUTING_AND_PRODUCTION_SIMULATION_2026-11-02_RU.md` | 12,289 | `829988457b85af63` |
| 118 | `docs/handoff/KOSMORA_STAGE2_MASTER_VERIFICATION_MATRIX_AND_RUNBOOK_2026-11-02_RU.md` | 15,822 | `7d261fafd489851d` |
| 119 | `docs/handoff/KOSMORA_STAGE2_UNIFIED_MIGRATION_PRIVACY_AND_IPC_2026-11-02_RU.md` | 4,594 | `862b97d4078a31b1` |
| 120 | `docs/handoff/KOSMORA_VAULT_BRIDGE_SEARCH_AND_EMERGENCY_SNAPSHOT_2026-11-02_RU.md` | 4,878 | `f51c453a3dbe4813` |
| 121 | `docs/handoff/KOSMORA_WORKFLOW_DAG_RECEIPTS_AND_UNIFIED_TASK_2026-11-02_RU.md` | 5,333 | `db344e6c70f728df` |
| 122 | `docs/handoff/KOSMORA_WORKFLOW_PORTABILITY_AND_FABLE_DISCOVERY_2026-11-02_RU.md` | 5,237 | `3c627952da9191d2` |
| 123 | `docs/handoff/KOSWORK_VAULT_DOCS_AND_SNAPSHOT_RESTORE_2026-11-01_RU.md` | 7,632 | `d41e3ff14586f793` |
| 124 | `docs/handoff/KOSWORK_WORKSPACE_FOLDER.md` | 12,333 | `b4828f884ad8bfe0` |
| 125 | `packages/core/src/adaptive-circuit-breaker.ts` | 5,589 | `81d0ad2ddfaf68cf` |
| 126 | `packages/core/src/ast-code-sandbox-verifier.ts` | 5,358 | `04a21ddd3c2bf1db` |
| 127 | `packages/core/src/bpe-context-estimator-and-audit.ts` | 7,498 | `2413713e66e496a3` |
| 128 | `packages/core/src/causal-counterfactual-attribution.ts` | 6,998 | `dfd70fad08fd62c3` |
| 129 | `packages/core/src/claim-grounding-verifier.ts` | 7,166 | `1dfddd233f998c84` |
| 130 | `packages/core/src/constrained-grammar-enforcer.ts` | 7,989 | `24d50b02440c298d` |
| 131 | `packages/core/src/datalog-inference-engine.ts` | 6,462 | `0ef5edf8fbe69f89` |
| 132 | `packages/core/src/differential-privacy-telemetry.ts` | 9,466 | `05b54f2c76a74bc5` |
| 133 | `packages/core/src/dynamic-context-budget-allocator.ts` | 6,382 | `82bd7c3d8574577e` |
| 134 | `packages/core/src/index.ts` | 1,546 | `2feaa0c9c3bbba7c` |
| 135 | `packages/core/src/kalman-cusum-drift-detector.ts` | 3,101 | `94341ea95e23a68b` |
| 136 | `packages/core/src/mcts-workflow-planner.ts` | 5,976 | `332b3b9cf66f16f2` |
| 137 | `packages/core/src/merkle-state-trie.ts` | 5,981 | `9283a3f03cc2d08c` |
| 138 | `packages/core/src/opentelemetry-trace-analyzer.ts` | 5,520 | `8a72303409856635` |
| 139 | `packages/core/src/petri-net-workflow-verifier.ts` | 6,994 | `3a6f581fc3dc364a` |
| 140 | `packages/core/src/pii-redaction-firewall.ts` | 5,275 | `c2f5e36d6a6db3cf` |
| 141 | `packages/core/src/prompt-caching-optimizer.ts` | 5,487 | `ccdeeb61caf6cfab` |
| 142 | `packages/core/src/prompt-injection-shield.ts` | 6,882 | `875aaa88e9540727` |
| 143 | `packages/core/src/shamir-secret-sharing-escrow.ts` | 7,870 | `3e7e2c956d37e97a` |
| 144 | `packages/core/src/speculative-tool-router.ts` | 16,661 | `084fae76342763ff` |
| 145 | `packages/core/src/thompson-sampling-bandit-router.ts` | 5,856 | `f918b78cc6194ecc` |
| 146 | `packages/core/src/zk-commitment-verifier.ts` | 4,730 | `e91a2c2fc10af1cc` |
| 147 | `packages/db/migrations/0060_drive_storage.sql` | 2,918 | `501a8a13933b3eca` |
| 148 | `packages/db/migrations/0063_unified_stage2_extensions.sql` | 8,444 | `7b8b5fc560b6cae3` |
| 149 | `packages/db/src/cdc-chunking-deduplicator.ts` | 9,602 | `d901041b9ca8efa2` |
| 150 | `packages/db/src/context-memory-hybrid-search.ts` | 21,633 | `ed2aa3a02f5a54ef` |
| 151 | `packages/db/src/context-memory-notes-migrator.ts` | 18,028 | `6b67668cb8815618` |
| 152 | `packages/db/src/context-memory-prefix-byte-cache.ts` | 6,594 | `cd74fcf9f38afb06` |
| 153 | `packages/db/src/context-memory-receipts-store.ts` | 8,524 | `c797650e49a916ce` |
| 154 | `packages/db/src/crdt-memory-sync-engine.ts` | 9,686 | `a3e8fd326b39fb9b` |
| 155 | `packages/db/src/cryptographic-audit-blackbox.ts` | 8,934 | `f5792266d7d9d25c` |
| 156 | `packages/db/src/cuckoo-and-bloom-filter-index.ts` | 10,596 | `619d53491898c7bd` |
| 157 | `packages/db/src/dense-vector-semantic-search.ts` | 13,688 | `9a65233c1ab5cb71` |
| 158 | `packages/db/src/episodic-reflexion-engine.ts` | 10,080 | `a2df3060d80f6e3e` |
| 159 | `packages/db/src/history-compaction-topic-analyzer.ts` | 18,133 | `d50ca41f586065fd` |
| 160 | `packages/db/src/hnsw-vector-index.ts` | 11,619 | `647fbf24f0326db7` |
| 161 | `packages/db/src/minhash-lsh-deduplicator.ts` | 7,471 | `d055ab251d31ed5f` |
| 162 | `packages/db/src/multi-agent-consensus-engine.ts` | 6,708 | `48d139b1ac9101ef` |
| 163 | `packages/db/src/product-quantization-vector-codec.ts` | 9,889 | `be5daa50e005f2f3` |
| 164 | `packages/db/src/profile-candidate-reconciler.ts` | 20,418 | `c53250adad724a5e` |
| 165 | `packages/db/src/roaring-positional-inverted-index.ts` | 22,988 | `a1922b9c887402dd` |
| 166 | `packages/db/src/self-healing-workflow-runtime.ts` | 9,006 | `5319cc9534565fe3` |
| 167 | `packages/db/src/temporal-knowledge-graph.ts` | 6,527 | `93949aa03611edcd` |
| 168 | `packages/db/src/vault-cross-citation-graph.ts` | 7,149 | `98a6074da4afed92` |
| 169 | `packages/db/src/vps-chat-history-migrator.ts` | 11,741 | `ebe4d8cc2e8807f3` |
| 170 | `packages/db/src/workflow-dag-templates-and-critic.ts` | 19,591 | `1b0cb926e34589eb` |
| 171 | `packages/db/src/workflow-portability-and-zip-exporter.ts` | 20,298 | `23162f5fa75071b4` |
| 172 | `packages/db/src/workflow-schedule-and-subworkflow-runner.ts` | 15,330 | `341f7dbd2f2a14ec` |
| 173 | `scripts/benchmark-kosmora-stage2-performance.mjs` | 12,993 | `ff0b198e39566d03` |
| 174 | `scripts/check-secrets.mjs` | 2,973 | `75c8a4f98057f946` |
| 175 | `scripts/driver-mock-gateway-live-e2e.mjs` | 14,370 | `d1820de54564cbb0` |
| 176 | `scripts/integration-cdc-ast-bandit-and-pdf-smoke.mjs` | 3,091 | `761de83832802950` |
| 177 | `scripts/integration-compaction-profile-and-vps-smoke.mjs` | 3,196 | `21516cd4a43d993e` |
| 178 | `scripts/integration-crdt-mcts-pii-and-excel-smoke.mjs` | 3,015 | `07ff41b184121a75` |
| 179 | `scripts/integration-cuckoo-shamir-causal-and-html-smoke.mjs` | 3,190 | `843310f9ae3198a5` |
| 180 | `scripts/integration-datalog-minhash-otel-and-clipboard-smoke.mjs` | 3,137 | `3b94e2982bafe66b` |
| 181 | `scripts/integration-drive-spool-and-koswork-report-smoke.mjs` | 2,614 | `0d7d0e0937c868e9` |
| 182 | `scripts/integration-dynamic-budget-and-blackbox-smoke.mjs` | 2,549 | `bc4376126a0ea58e` |
| 183 | `scripts/integration-fable-memory-cache-and-workflows-smoke.mjs` | 2,774 | `8fb3dbc3f3e20678` |
| 184 | `scripts/integration-google-drive-smoke.mjs` | 3,317 | `2ba210303da4a3d2` |
| 185 | `scripts/integration-hnsw-merkle-grammar-and-dpi-smoke.mjs` | 3,329 | `3fbbbdfecda6c47f` |
| 186 | `scripts/integration-hybrid-memory-and-download-smoke.mjs` | 2,901 | `cbded74aef3ae95a` |
| 187 | `scripts/integration-journal-recovery-hazard-and-bpe-smoke.mjs` | 3,001 | `8c6666d61da3a955` |
| 188 | `scripts/integration-nextgen-technologies-smoke.mjs` | 4,185 | `c76581a6654a8cfb` |
| 189 | `scripts/integration-pptx-temporal-kg-and-shield-smoke.mjs` | 3,160 | `1c0b631d245ea887` |
| 190 | `scripts/integration-pq-kalman-zk-and-archive-smoke.mjs` | 3,120 | `6cef003f95893fcf` |
| 191 | `scripts/integration-reflexion-grounding-and-dom-diff-smoke.mjs` | 3,068 | `d1fe6d7ca21bd7e8` |
| 192 | `scripts/integration-roaring-dp-petri-and-wav-smoke.mjs` | 3,133 | `f5231842631feda8` |
| 193 | `scripts/integration-self-healing-and-watchdog-smoke.mjs` | 3,192 | `179eb7c4c4cc143d` |
| 194 | `scripts/integration-vault-bridge-search-and-emergency-smoke.mjs` | 2,933 | `3028c4480d30edd0` |
| 195 | `scripts/integration-vault-memory-smoke.mjs` | 4,113 | `10d5727b4a87288f` |
| 196 | `scripts/integration-workflow-dag-receipts-and-unified-smoke.mjs` | 3,074 | `2f5b028c3eda5891` |
| 197 | `scripts/integration-workflow-portability-and-fable-discovery-smoke.mjs` | 2,681 | `4068c49d5070657c` |
| 198 | `scripts/offline-typescript.mjs` | 6,055 | `8ad700099d9b31ef` |
| 199 | `scripts/remediate-memory-and-vault-ci.mjs` | 4,438 | `573757aebbc5e0ec` |
| 200 | `scripts/run-all-stage2-acceptance-suites.mjs` | 3,227 | `38ba73fbe73bed58` |
| 201 | `scripts/stage2-master-verification-matrix-runner.mjs` | 10,185 | `ed18ccc4b5accd00` |
| 202 | `scripts/vps-chat-recovery-and-tls-probe.mjs` | 2,373 | `9c2897e4b7de3eb9` |
