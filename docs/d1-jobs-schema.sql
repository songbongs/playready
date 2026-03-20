CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  progress_message TEXT,
  game_name TEXT,
  bgg_id TEXT,
  rulebook_file_name TEXT,
  faq_file_name TEXT,
  extra_file_names TEXT,
  input_key TEXT,
  result_key TEXT,
  error_message TEXT,
  error_stage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  source_mode TEXT,
  source_optimization TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_session_created_at
  ON jobs (session_id, created_at DESC);
