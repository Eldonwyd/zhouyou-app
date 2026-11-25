-- 周游地图（Zhouyou Map）平台免费体验 AI Token 额度统计表
-- 按北京时间（UTC+8）统计单账号每日 / 每月 Token 消耗与全站每日总熔断（user_id = '__SITE__'）。

CREATE TABLE IF NOT EXISTS free_ai_usage_daily (
  user_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  requests_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_free_ai_daily_day ON free_ai_usage_daily(day_key);

CREATE TABLE IF NOT EXISTS free_ai_usage_monthly (
  user_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  requests_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_free_ai_monthly_month ON free_ai_usage_monthly(month_key);
