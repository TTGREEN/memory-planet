-- evolution_tasks: 断点续传任务队列
-- 用于 dream-entropy 的长时 LLM 调用断点续传
CREATE TABLE IF NOT EXISTS evolution_tasks (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL,
  pair_data       TEXT NOT NULL,   -- JSON: [{id, content, predicate}, {id, content, predicate}]
  status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING / PROCESSING / COMPLETED / FAILED
  result_data     TEXT,            -- JSON: paradigm_shift_result (if COMPLETED)
  error_msg       TEXT,            -- error details (if FAILED)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);