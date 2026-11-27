CREATE TABLE document_answer_batches (
  run_id TEXT NOT NULL REFERENCES document_answer_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  notes_json TEXT NOT NULL,
  verified INTEGER NOT NULL CHECK(verified IN (0, 1)),
  PRIMARY KEY (run_id, ordinal)
) WITHOUT ROWID;
