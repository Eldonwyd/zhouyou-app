-- 周游地图（Zhouyou Map）开发者监控与动态配置表（Cloudflare D1）
-- 仅存储脱敏聚合计数、AI 请求元数据（不含对话正文）、GitHub 每日归档快照、动态配置与审计日志。

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_daily (
  day_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '__all__',
  count INTEGER NOT NULL DEFAULT 0,
  extra_num INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day_key, metric, dimension)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_daily_metric ON telemetry_daily(metric, day_key DESC);

CREATE TABLE IF NOT EXISTS free_ai_request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 200,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_free_ai_logs_created ON free_ai_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_free_ai_logs_user ON free_ai_request_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS github_daily_snapshots (
  day_key TEXT PRIMARY KEY,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  watchers INTEGER NOT NULL DEFAULT 0,
  release_downloads_total INTEGER NOT NULL DEFAULT 0,
  traffic_views_14d INTEGER NOT NULL DEFAULT 0,
  traffic_uniques_14d INTEGER NOT NULL DEFAULT 0,
  traffic_clones_14d INTEGER NOT NULL DEFAULT 0,
  traffic_clones_uniques_14d INTEGER NOT NULL DEFAULT 0,
  referrers_json TEXT NOT NULL DEFAULT '[]',
  paths_json TEXT NOT NULL DEFAULT '[]',
  releases_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS web_visitors_daily (
  day_key TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 1,
  first_path TEXT NOT NULL DEFAULT '/',
  referrer_source TEXT NOT NULL DEFAULT 'direct',
  is_demo INTEGER NOT NULL DEFAULT 0,
  is_logged_in INTEGER NOT NULL DEFAULT 0,
  did_download INTEGER NOT NULL DEFAULT 0,
  country TEXT NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (day_key, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_web_visitors_day ON web_visitors_daily(day_key DESC, referrer_source);
