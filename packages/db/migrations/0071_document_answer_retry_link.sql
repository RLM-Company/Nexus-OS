ALTER TABLE document_answer_runs ADD COLUMN retry_of TEXT;
--> statement-breakpoint
ALTER TABLE document_answer_runs ADD COLUMN retry_request_id TEXT;
--> statement-breakpoint
CREATE INDEX document_answer_runs_retry_request_idx
  ON document_answer_runs(owner_id, retry_request_id)
  WHERE retry_request_id IS NOT NULL;
