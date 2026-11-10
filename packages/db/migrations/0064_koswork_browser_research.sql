-- Migration 0064: Koswork Browser Research Cycle (Searches, Sources, UTF-16 Excerpts & Verifiable Reports)
-- Branch: gemini/koswork-browser-research

CREATE TABLE IF NOT EXISTS koswork_browser_searches (
  search_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'agent')),
  query TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_endpoint TEXT NOT NULL,
  total_results INTEGER NOT NULL DEFAULT 0,
  searched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_koswork_browser_searches_owner
  ON koswork_browser_searches(owner_id, searched_at DESC);

CREATE TABLE IF NOT EXISTS koswork_browser_sources (
  source_id TEXT PRIMARY KEY,
  search_id TEXT,
  owner_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  http_status INTEGER NOT NULL DEFAULT 200,
  available INTEGER NOT NULL DEFAULT 1,
  page_version INTEGER NOT NULL DEFAULT 1,
  page_date TEXT,
  event_date TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (search_id) REFERENCES koswork_browser_searches(search_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_koswork_browser_sources_owner
  ON koswork_browser_sources(owner_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_koswork_browser_sources_canonical
  ON koswork_browser_sources(owner_id, canonical_url);

CREATE TABLE IF NOT EXISTS koswork_browser_excerpts (
  excerpt_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  page_version INTEGER NOT NULL DEFAULT 1,
  start_utf16 INTEGER NOT NULL,
  end_utf16 INTEGER NOT NULL,
  quote TEXT NOT NULL,
  quote_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (end_utf16 > start_utf16 AND start_utf16 >= 0),
  FOREIGN KEY (source_id) REFERENCES koswork_browser_sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_koswork_browser_excerpts_source
  ON koswork_browser_excerpts(source_id, start_utf16);

CREATE TABLE IF NOT EXISTS koswork_browser_research_reports (
  report_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  question TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  confirmed_claims_json TEXT NOT NULL,
  unconfirmed_claims_json TEXT NOT NULL,
  contradictions_json TEXT NOT NULL,
  outdated_findings_json TEXT NOT NULL,
  unavailable_sources_json TEXT NOT NULL,
  substitution_incidents_json TEXT NOT NULL,
  resource_metrics_json TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  html_path TEXT NOT NULL,
  csv_path TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_koswork_browser_research_reports_owner
  ON koswork_browser_research_reports(owner_id, created_at DESC);
