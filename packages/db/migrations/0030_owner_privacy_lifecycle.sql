-- Slot 0030 / idx30 / when1791580800005. Runs through the Drizzle migration journal only.
-- The canonical usage tables have ON DELETE CASCADE; preserve accounting on ALL parent deletes,
-- not just privacy deletion, and also on direct ledger-row deletion.
CREATE TABLE kosmora_retained_accounting (
  source TEXT NOT NULL CHECK(source IN ('general','project')),
  usage_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_requested TEXT NOT NULL,
  model_resolved TEXT,
  registry_version TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  estimated_input_tokens INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL,
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  estimated_cost_amount REAL,
  calculated_cost_amount REAL,
  currency TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source,usage_id)
);
--> statement-breakpoint
CREATE INDEX kosmora_retained_accounting_owner_created_idx ON kosmora_retained_accounting(owner_id,created_at);
--> statement-breakpoint
CREATE TABLE kosmora_owner_data_lifecycle (
  owner_id TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL CHECK(epoch >= 1),
  state TEXT NOT NULL CHECK(state IN ('active','quiescing','deleting','deleted','error')),
  operation_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT
);
--> statement-breakpoint
CREATE TRIGGER kosmora_retain_general_usage_before_delete
BEFORE DELETE ON general_chat_model_usage BEGIN
 INSERT OR IGNORE INTO kosmora_retained_accounting
 (source,usage_id,run_id,owner_id,status,provider_id,model_requested,model_resolved,registry_version,
  attempt,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
  estimated_cost_amount,calculated_cost_amount,currency,error_code,created_at,updated_at)
 SELECT 'general', OLD.usage_id, OLD.run_id, c.owner_id, OLD.status, OLD.provider_id,
 OLD.model_requested, OLD.model_resolved, OLD.registry_version, OLD.attempt,
 OLD.estimated_input_tokens, OLD.max_output_tokens, OLD.actual_input_tokens,
 OLD.actual_output_tokens, OLD.estimated_cost_amount, OLD.calculated_cost_amount,
 OLD.currency, OLD.error_code, OLD.created_at, OLD.updated_at
 FROM general_chats c WHERE c.id=OLD.chat_id;
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_retain_project_usage_before_delete
BEFORE DELETE ON model_usage_ledger BEGIN
 INSERT OR IGNORE INTO kosmora_retained_accounting
 (source,usage_id,run_id,owner_id,status,provider_id,model_requested,model_resolved,registry_version,
  attempt,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
  estimated_cost_amount,calculated_cost_amount,currency,error_code,created_at,updated_at)
 SELECT 'project', OLD.usage_id, OLD.run_id, p.owner_id, OLD.status, OLD.provider_id,
 OLD.model_requested, OLD.model_resolved, OLD.registry_version, OLD.attempt,
 OLD.estimated_input_tokens, OLD.max_output_tokens, OLD.actual_input_tokens,
 OLD.actual_output_tokens, OLD.estimated_cost_amount, OLD.calculated_cost_amount,
 OLD.currency, OLD.error_code, OLD.created_at, OLD.updated_at
 FROM projects p WHERE p.id=OLD.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_retain_general_on_chat_delete
BEFORE DELETE ON general_chats BEGIN
 INSERT OR IGNORE INTO kosmora_retained_accounting
 (source,usage_id,run_id,owner_id,status,provider_id,model_requested,model_resolved,registry_version,
  attempt,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
  estimated_cost_amount,calculated_cost_amount,currency,error_code,created_at,updated_at)
 SELECT 'general',u.usage_id,u.run_id, OLD.owner_id,u.status,u.provider_id,u.model_requested,
 u.model_resolved,u.registry_version,u.attempt,u.estimated_input_tokens,u.max_output_tokens,
 u.actual_input_tokens,u.actual_output_tokens,u.estimated_cost_amount,u.calculated_cost_amount,
 u.currency,u.error_code,u.created_at,u.updated_at
 FROM general_chat_model_usage u WHERE u.chat_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_retain_project_on_project_delete
BEFORE DELETE ON projects BEGIN
 INSERT OR IGNORE INTO kosmora_retained_accounting
 (source,usage_id,run_id,owner_id,status,provider_id,model_requested,model_resolved,registry_version,
  attempt,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
  estimated_cost_amount,calculated_cost_amount,currency,error_code,created_at,updated_at)
 SELECT 'project',u.usage_id,u.run_id, OLD.owner_id,u.status,u.provider_id,u.model_requested,
 u.model_resolved,u.registry_version,u.attempt,u.estimated_input_tokens,u.max_output_tokens,
 u.actual_input_tokens,u.actual_output_tokens,u.estimated_cost_amount,u.calculated_cost_amount,
 u.currency,u.error_code,u.created_at,u.updated_at
 FROM model_usage_ledger u WHERE u.project_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chats_insert BEFORE INSERT ON general_chats BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chats_update BEFORE UPDATE ON general_chats BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chat_messages_insert BEFORE INSERT ON general_chat_messages BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chat_messages_update BEFORE UPDATE ON general_chat_messages BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chat_runs_insert BEFORE INSERT ON general_chat_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_general_chat_runs_update BEFORE UPDATE ON general_chat_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_projects_insert BEFORE INSERT ON projects BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_projects_update BEFORE UPDATE ON projects BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_chats_insert BEFORE INSERT ON chats BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_chats_update BEFORE UPDATE ON chats BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_messages_insert BEFORE INSERT ON messages BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_messages_update BEFORE UPDATE ON messages BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_runs_insert BEFORE INSERT ON runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_runs_update BEFORE UPDATE ON runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id)
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_manager_work_insert BEFORE INSERT ON manager_work BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_manager_work_update BEFORE UPDATE ON manager_work BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_kosmora_account_preferences_insert BEFORE INSERT ON kosmora_account_preferences BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_kosmora_account_preferences_update BEFORE UPDATE ON kosmora_account_preferences BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_kosmora_chat_preferences_insert BEFORE INSERT ON kosmora_chat_preferences BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'INSERT'='INSERT')));
END;
--> statement-breakpoint
CREATE TRIGGER kosmora_fence_kosmora_chat_preferences_update BEFORE UPDATE ON kosmora_chat_preferences BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id
   AND (f.state IN ('deleting','deleted','error') OR (f.state='quiescing' AND 'UPDATE'='INSERT')));
END;

--> statement-breakpoint
CREATE TABLE kosmora_auxiliary_model_usage (
  owner_id TEXT NOT NULL,run_id TEXT NOT NULL,attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('document')),
  provider_id TEXT NOT NULL,model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
  cost_amount REAL NOT NULL CHECK(cost_amount>=0),currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,run_id,attempt)
);
--> statement-breakpoint
CREATE INDEX kosmora_auxiliary_owner_created_idx ON kosmora_auxiliary_model_usage(owner_id,created_at);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS code_agent_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      owner_id TEXT NOT NULL, version INTEGER NOT NULL, state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
 CREATE INDEX IF NOT EXISTS code_agent_project ON code_agent_runs(project_id, owner_id, created_at);

--> statement-breakpoint
CREATE TABLE kosmora_retained_policy_audit(owner_id TEXT NOT NULL,source TEXT NOT NULL,source_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(owner_id,source,source_id));

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_document_library_chunks_insert BEFORE INSERT ON document_library_chunks BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM document_library_files WHERE id=NEW.file_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_document_library_chunks_update BEFORE UPDATE ON document_library_chunks BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM document_library_files WHERE id=NEW.file_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_work_checkpoints_insert BEFORE INSERT ON work_checkpoints BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM manager_work WHERE id=NEW.work_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_work_checkpoints_update BEFORE UPDATE ON work_checkpoints BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM manager_work WHERE id=NEW.work_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_manager_work_files_insert BEFORE INSERT ON manager_work_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM manager_work WHERE id=NEW.execution_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_manager_work_files_update BEFORE UPDATE ON manager_work_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM manager_work WHERE id=NEW.execution_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_document_library_files_insert BEFORE INSERT ON document_library_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_document_library_files_update BEFORE UPDATE ON document_library_files BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_research_v1_runs_insert BEFORE INSERT ON research_v1_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_research_v1_runs_update BEFORE UPDATE ON research_v1_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_code_agent_runs_insert BEFORE INSERT ON code_agent_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_code_agent_runs_update BEFORE UPDATE ON code_agent_runs BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_blueprints_insert BEFORE INSERT ON agent_blueprints BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_blueprints_update BEFORE UPDATE ON agent_blueprints BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_instances_insert BEFORE INSERT ON agent_instances BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_instances_update BEFORE UPDATE ON agent_instances BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_studio_mutations_insert BEFORE INSERT ON agent_studio_mutations BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_studio_mutations_update BEFORE UPDATE ON agent_studio_mutations BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_studio_decision_events_insert BEFORE INSERT ON agent_studio_decision_events BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_agent_studio_decision_events_update BEFORE UPDATE ON agent_studio_decision_events BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_project_memory_insert BEFORE INSERT ON project_memory BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_project_memory_update BEFORE UPDATE ON project_memory BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=NEW.owner_id AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_work_artifact_versions_insert BEFORE INSERT ON work_artifact_versions BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id) AND f.state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER kosmora_privacy_work_artifact_versions_update BEFORE UPDATE ON work_artifact_versions BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id) AND f.state<>'active');
END;
