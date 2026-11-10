-- Additive Stage-2 migration (0056..0063 consolidated schema & OWNER_DATA_FENCED triggers)
CREATE TABLE IF NOT EXISTS kosmora_owner_data_lifecycle (
  owner_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  epoch INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('personal', 'chat', 'project')),
  chat_id TEXT,
  project_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'constraint', 'hypothesis')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  source_chat_message_id TEXT,
  source_project_message_id TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  creation_key TEXT,
  creation_sha256 TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_versions (
  entry_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (entry_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_settings (
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  chat_id TEXT,
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  use_personal INTEGER NOT NULL DEFAULT 1,
  source_chat_ids_json TEXT NOT NULL DEFAULT '[]',
  project_ids_json TEXT NOT NULL DEFAULT '[]',
  compact_history INTEGER NOT NULL DEFAULT 0,
  temporary_mode INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, target_kind, target_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_owner_defaults (
  owner_id TEXT PRIMARY KEY NOT NULL,
  default_enabled INTEGER NOT NULL DEFAULT 1,
  default_use_personal INTEGER NOT NULL DEFAULT 1,
  default_auto_extract INTEGER NOT NULL DEFAULT 0,
  default_temporary_mode INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_candidate_dismissals (
  owner_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  chat_message_id TEXT,
  project_message_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, candidate_id),
  CHECK ((chat_message_id IS NULL) <> (project_message_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_usage (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  chat_id TEXT,
  project_id TEXT,
  run_id TEXT NOT NULL,
  general_run_id TEXT,
  project_run_id TEXT,
  request_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  phase TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_drive_spool_journal (
  backup_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  spool_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('spooled', 'uploading', 'completed', 'failed', 'purged')),
  attempts INTEGER NOT NULL DEFAULT 0,
  drive_file_id TEXT,
  last_error_code TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_drive_recovered_catalog (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  drive_file_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  chat_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  work_file_count INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('verified', 'corrupt')),
  created_at TEXT NOT NULL,
  recovered_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  client_creation_id TEXT,
  creation_json TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_versions (
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  dag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, project_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_schedules (
  schedule_id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  cron_or_interval TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_slot_iso TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS workflow_version_immutable
BEFORE UPDATE ON kosmora_workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'WORKFLOW_VERSION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_entries_ins
BEFORE INSERT ON context_memory_entries
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_entries_upd
BEFORE UPDATE ON context_memory_entries
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_profile_candidate_dismissals_ins
BEFORE INSERT ON profile_candidate_dismissals
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_usage_ins
BEFORE INSERT ON context_memory_usage
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_workflow_definitions_ins
BEFORE INSERT ON kosmora_workflow_definitions
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_workflow_runs_ins
BEFORE INSERT ON kosmora_workflow_runs
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_roaring_inverted_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  doc_count INTEGER NOT NULL,
  term_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_probabilistic_filter_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  filter_type TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace, filter_type)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_pq_codebooks (
  codebook_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  subspaces INTEGER NOT NULL,
  centroids_per_subspace INTEGER NOT NULL,
  codebook_json TEXT NOT NULL,
  codes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_ai_intelligence_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  custom_system_prompt TEXT,
  auto_adapt_style INTEGER NOT NULL DEFAULT 1,
  default_reasoning_mode TEXT NOT NULL DEFAULT 'auto',
  custom_temperature REAL,
  custom_top_p REAL,
  custom_thinking_budget INTEGER,
  learned_style_profile_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_user_implicit_preferences (
  preference_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL,
  directive TEXT NOT NULL,
  confidence REAL NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, directive)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_memory_retention_traces (
  memory_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'episodic',
  importance REAL NOT NULL DEFAULT 0.5,
  recall_count INTEGER NOT NULL DEFAULT 1,
  stability_hours REAL NOT NULL DEFAULT 24.0,
  last_recalled_at_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_stream_sketch_snapshots (
  sketch_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  hll_registers_base64 TEXT NOT NULL,
  cms_matrix_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_suffix_array_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  corpus_id TEXT NOT NULL,
  corpus_text TEXT NOT NULL,
  suffix_array_json TEXT NOT NULL,
  lcp_array_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, corpus_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_saga_executions (
  saga_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_steps_json TEXT NOT NULL,
  compensated_steps_json TEXT NOT NULL,
  failure_reason TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_transactional_outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  saga_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dispatched INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_graph_communities (
  community_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  graph_namespace TEXT NOT NULL,
  member_node_ids_json TEXT NOT NULL,
  hub_node_id TEXT NOT NULL,
  modularity_contribution REAL NOT NULL,
  summary_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_lsm_sstables (
  sstable_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  min_key TEXT NOT NULL,
  max_key TEXT NOT NULL,
  entries_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_timeseries_blocks (
  block_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  point_count INTEGER NOT NULL,
  base_timestamp_ms INTEGER NOT NULL,
  base_value REAL NOT NULL,
  delta_of_deltas_json TEXT NOT NULL,
  value_deltas_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_columnar_stripes (
  stripe_id TEXT PRIMARY KEY NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  min_numeric REAL,
  max_numeric REAL,
  min_lexical TEXT,
  max_lexical TEXT,
  bit_width INTEGER NOT NULL,
  dictionary_json TEXT NOT NULL,
  rle_runs_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_event_store_stream (
  aggregate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  PRIMARY KEY (aggregate_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_event_store_snapshots (
  aggregate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  PRIMARY KEY (aggregate_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_mvcc_bptree_records (
  index_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  xmin_tx INTEGER NOT NULL,
  xmax_tx INTEGER,
  value_json TEXT NOT NULL,
  PRIMARY KEY (index_name, record_key, xmin_tx)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kosmora_mvcc_bptree_range
  ON kosmora_mvcc_bptree_records (index_name, record_key, xmin_tx, xmax_tx);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_fencing_leases (
  resource_key TEXT PRIMARY KEY NOT NULL,
  holder_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  last_verified_token INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_tamper_evident_ledger (
  ledger_namespace TEXT NOT NULL,
  seq_no INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (ledger_namespace, seq_no)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_spatial_rtree_items (
  layer_name TEXT NOT NULL,
  item_id TEXT NOT NULL,
  min_x REAL NOT NULL,
  min_y REAL NOT NULL,
  max_x REAL NOT NULL,
  max_y REAL NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY (layer_name, item_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kosmora_spatial_rtree_mbr
  ON kosmora_spatial_rtree_items (layer_name, min_x, max_x, min_y, max_y);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_2pc_transactions (
  tx_id TEXT PRIMARY KEY NOT NULL,
  coordinator_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_timing_wheel_timers (
  timer_id TEXT PRIMARY KEY NOT NULL,
  slot_index INTEGER NOT NULL,
  rounds_remaining INTEGER NOT NULL,
  due_at_tick INTEGER NOT NULL,
  task_payload_json TEXT NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kosmora_timing_wheel_slot
  ON kosmora_timing_wheel_timers (fired, slot_index, rounds_remaining);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_lexorank_ordered_items (
  list_namespace TEXT NOT NULL,
  item_id TEXT NOT NULL,
  lexo_rank TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (list_namespace, item_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_kosmora_lexorank_sort
  ON kosmora_lexorank_ordered_items (list_namespace, lexo_rank ASC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_sliding_window_counters (
  subject_key TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_key, window_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_treap_order_nodes (
  tree_name TEXT NOT NULL,
  node_key REAL NOT NULL,
  priority INTEGER NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (tree_name, node_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_aries_wal_records (
  lsn INTEGER PRIMARY KEY NOT NULL,
  tx_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  page_id TEXT,
  before_image TEXT,
  after_image TEXT,
  undo_next_lsn INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_ssi_rw_antidependencies (
  reader_tx_id TEXT NOT NULL,
  writer_tx_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  PRIMARY KEY (reader_tx_id, writer_tx_id, resource_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_event_time_windows (
  window_start_ms INTEGER PRIMARY KEY NOT NULL,
  window_end_ms INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  sum_value REAL NOT NULL,
  max_value REAL NOT NULL
);

-- Phase 18: Cryptographic Hexary Merkle-Patricia State Trie & IETF Idempotency-Key Ledger
CREATE TABLE IF NOT EXISTS kosmora_merkle_patricia_nodes (
  prefix_hex TEXT PRIMARY KEY,
  node_hash TEXT NOT NULL,
  value_payload TEXT,
  children_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kosmora_idempotency_key_ledger (
  idempotency_key TEXT PRIMARY KEY,
  payload_sha256 TEXT NOT NULL,
  execution_state TEXT NOT NULL,
  response_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- Phase 19: Observed-Remove Set (OR-Set CRDT) & Hierarchical FinOps Cost Attribution Ledger
CREATE TABLE IF NOT EXISTS kosmora_orset_elements (
  unique_tag TEXT PRIMARY KEY,
  element_value TEXT NOT NULL,
  replica_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kosmora_orset_tombstones (
  unique_tag TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS kosmora_cost_attribution_entries (
  entry_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_micros_usd INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Phase 20: Snodgrass SQL:2011 Bitemporal Valid/Transaction Time & Birman-Schiper-Stephenson Causal Broadcast
CREATE TABLE IF NOT EXISTS kosmora_bitemporal_facts (
  fact_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT NOT NULL,
  payload_value TEXT NOT NULL,
  valid_from_ms INTEGER NOT NULL,
  valid_to_ms INTEGER NOT NULL,
  tx_recorded_at_ms INTEGER NOT NULL,
  tx_superseded_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kosmora_causal_broadcast_queue (
  message_id TEXT PRIMARY KEY,
  sender_node_id TEXT NOT NULL,
  vector_clock_json TEXT NOT NULL,
  payload TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);

-- Phase 21: Decorrelated Jitter Exponential Backoff DLQ & Time-Travel Multi-Version Snapshot Differ
CREATE TABLE IF NOT EXISTS kosmora_dlq_retry_tasks (
  task_id TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  status TEXT NOT NULL,
  prev_delay_ms INTEGER NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS kosmora_snapshot_revisions (
  revision_id INTEGER NOT NULL,
  state_key TEXT NOT NULL,
  state_value TEXT NOT NULL,
  PRIMARY KEY (revision_id, state_key)
);

-- Phase 22: Chandy-Lamport DAG Checkpoint Barrier Alignment & Distributed Token-Ring Coordinator
CREATE TABLE IF NOT EXISTS kosmora_dag_checkpoint_barriers (
  operator_id TEXT NOT NULL,
  epoch_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  arrived_at_ms INTEGER NOT NULL,
  PRIMARY KEY (operator_id, epoch_id, channel_id)
);

CREATE TABLE IF NOT EXISTS kosmora_dag_committed_checkpoints (
  operator_id TEXT NOT NULL,
  epoch_id INTEGER NOT NULL,
  state_snapshot_json TEXT NOT NULL,
  committed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (operator_id, epoch_id)
);

CREATE TABLE IF NOT EXISTS kosmora_token_ring_holders (
  ring_id TEXT PRIMARY KEY,
  members_json TEXT NOT NULL,
  holder_index INTEGER NOT NULL,
  epoch_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kosmora_barrier_phases (
  barrier_id TEXT NOT NULL,
  phase_number INTEGER NOT NULL,
  worker_id TEXT NOT NULL,
  PRIMARY KEY (barrier_id, phase_number, worker_id)
);
