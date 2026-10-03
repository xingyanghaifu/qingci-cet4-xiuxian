-- 青词天路 · 反馈收集（Cloudflare D1）
--
-- 建库与初始化：
--   npx wrangler d1 create qingci-feedback
--   npx wrangler d1 execute qingci-feedback --remote --file=db/schema.sql
-- 绑定（Pages 项目设置或 wrangler.toml）：
--   [[d1_databases]]  binding = "DB"  database_name = "qingci-feedback"  database_id = "<id>"
-- 可选加密盐（建议配置，用于 IP 哈希去标识化）：
--   npx wrangler pages secret put FEEDBACK_SALT

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL,             -- ISO 时间
  kind         TEXT    NOT NULL,             -- bug | suggestion | content | other
  description  TEXT    NOT NULL,
  contact      TEXT,                         -- 可选联系方式
  screenshot   TEXT,                         -- 可选截图 data URL（服务端限制 ≤512KB）
  app_version  TEXT,
  page         TEXT,                         -- 提交时所在标签页/题目 id（便于定位）
  user_agent   TEXT,
  ip_hash      TEXT                          -- IP 的加盐 SHA-256 前 16 位，仅用于限流
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ip ON feedback (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_kind ON feedback (kind, created_at DESC);

-- ============================================================
-- 道友小组（P2.11 学习小组 / 排行榜）
--
-- 隐私约束（服务端强制，见 functions/api/group.ts）：
--   · 只有昵称，没有真名/邮箱/手机号/账号 ID；
--   · 只有聚合字段：境界档位、粗粒度进度（5 的倍数）、累计学习天数；
--   · **不存任何逐题作答数据，也不存分数**；
--   · member_id 是客户端随机生成的匿名 ID，与账号体系解耦。
-- ============================================================

CREATE TABLE IF NOT EXISTS study_groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,       -- 6 位邀请码（排除 0/O/1/I 等易混字符）
  name         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id     INTEGER NOT NULL,
  member_id    TEXT    NOT NULL,             -- 匿名 ID（客户端生成）
  nickname     TEXT    NOT NULL,             -- 仅昵称
  realm_index  INTEGER NOT NULL DEFAULT 0,   -- 0–4
  progress     INTEGER NOT NULL DEFAULT 0,   -- 0–100，入库前分档为 5 的倍数
  study_days   INTEGER NOT NULL DEFAULT 0,   -- 累计学习天数（不共享具体答题数据）
  week_key     TEXT    NOT NULL,             -- 2026-W40
  month_key    TEXT    NOT NULL,             -- 2026-10
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id, realm_index DESC, progress DESC);
