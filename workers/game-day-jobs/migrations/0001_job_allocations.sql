-- One row per job slot per round. Rows are created before allocation (status 'pending'),
-- filled automatically once the supplying boards are saved, and edited by the organiser.
CREATE TABLE IF NOT EXISTS job_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season INTEGER NOT NULL,
  round_name TEXT NOT NULL,
  job_id TEXT NOT NULL,
  game_grade TEXT NOT NULL,
  game_home INTEGER NOT NULL DEFAULT 0,
  job_type TEXT NOT NULL,
  slot_no INTEGER NOT NULL,
  supplier TEXT NOT NULL,
  player_key TEXT,
  player_name TEXT,
  member_id INTEGER,
  playhq_player_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  fair INTEGER,
  seed INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (season, round_name, job_id)
);
CREATE INDEX IF NOT EXISTS idx_job_allocations_player ON job_allocations (season, player_key);
