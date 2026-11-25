-- 周游地图（Zhouyou Map）Cloudflare D1 数据库初始化脚本
-- 仅存储账号、全文本同步数据（攻略/地图点亮/文字手账花费）、好友、亲密关系、行程群协作与分享元数据。
-- 照片、视频、语音等媒体文件保留在用户本地，通过 ZIP 备份迁移。

PRAGMA foreign_keys = ON;

-- 1. 用户账号表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone_norm TEXT UNIQUE,
  email_norm TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  security_question TEXT NOT NULL,
  security_answer_hash TEXT NOT NULL,
  security_answer_salt TEXT NOT NULL,
  security_fail_count INTEGER NOT NULL DEFAULT 0,
  security_locked_until TEXT,
  nickname TEXT NOT NULL,
  nickname_norm TEXT NOT NULL UNIQUE,
  friend_code TEXT NOT NULL UNIQUE,
  avatar_preset TEXT NOT NULL DEFAULT 'bear',
  motto TEXT NOT NULL DEFAULT '',
  map_visibility TEXT NOT NULL DEFAULT 'friends', -- 'friends' | 'intimate' | 'private'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_nickname_norm ON users(nickname_norm);
CREATE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code);

-- 2. 多端登录会话表
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'web', -- 'web' | 'desktop' | 'mobile'
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);

-- 3. 轻量限流表（防登录/注册/密保/建群暴力请求）
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- 4. 个人纯文本同步记录表（marks / badges / trips / places / entries / plans / plannerPreferences）
CREATE TABLE IF NOT EXISTS user_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (user_id, store_name, record_id)
);

CREATE INDEX IF NOT EXISTS idx_user_records_sync ON user_records(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_records_store ON user_records(user_id, store_name);

-- 5. 行程群表（支持一次行程一个群，也支持复用家人群等已有群）
CREATE TABLE IF NOT EXISTS travel_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON travel_groups(invite_code);

-- 6. 行程群成员表
CREATE TABLE IF NOT EXISTS travel_group_members (
  group_id TEXT NOT NULL REFERENCES travel_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON travel_group_members(user_id);

-- 7. 面对面 4 位数字建群临时房间表（30 分钟有效）
CREATE TABLE IF NOT EXISTS face_to_face_rooms (
  pin_code TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES travel_groups(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 8. AI 攻略独立主表（支持个人私有与绑定行程群多人协作）
CREATE TABLE IF NOT EXISTS ai_plans (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES travel_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_plans_owner ON ai_plans(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_plans_group ON ai_plans(group_id, updated_at);

-- 9. 攻略多人编辑动态与历史快照表（支持防误删一键回退）
CREATE TABLE IF NOT EXISTS ai_plan_revisions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  editor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  editor_nickname TEXT NOT NULL,
  summary TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan ON ai_plan_revisions(plan_id, version DESC);

-- 10. 好友关系表
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);

-- 11. 亲密关系表（情侣 / 家人 / 挚友 / 闺蜜）
CREATE TABLE IF NOT EXISTS intimacy_bonds (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, -- 'couple' | 'family' | 'soulmate' | 'bestie'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active'
  custom_label TEXT NOT NULL DEFAULT '',
  anniversary_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_intimacy_a ON intimacy_bonds(user_a_id, status);
CREATE INDEX IF NOT EXISTS idx_intimacy_b ON intimacy_bonds(user_b_id, status);

-- 12. 群内行程景点/餐厅小投票表
CREATE TABLE IF NOT EXISTS plan_votes (
  plan_id TEXT NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL, -- 'want' | 'backup' | 'skip'
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, item_key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_votes_plan ON plan_votes(plan_id);

-- 13. 群内行程景点/餐厅留言批注表
CREATE TABLE IF NOT EXISTS plan_comments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ai_plans(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_comments_plan ON plan_comments(plan_id, created_at);

-- 14. 群内 AA 记账表（金额单位：整数分）
CREATE TABLE IF NOT EXISTS group_expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES travel_groups(id) ON DELETE CASCADE,
  plan_id TEXT,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_user_ids_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses(group_id, date DESC);

-- 15. 行程分享表（站内推送、微信/QQ 分享链接与周游口令）
CREATE TABLE IF NOT EXISTS plan_shares (
  code TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_nickname TEXT NOT NULL,
  recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'copy', -- 'copy' | 'collab'
  group_id TEXT REFERENCES travel_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  days_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_shares_recipient ON plan_shares(recipient_user_id, created_at DESC);

-- 16. 站内消息提醒表（驱动「同行旅伴」小红点）
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'friend_req' | 'friend_accepted' | 'intimacy_req' | 'intimacy_accepted' | 'group_invite' | 'plan_received' | 'plan_edited'
  actor_id TEXT,
  actor_nickname TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  target_ref_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
