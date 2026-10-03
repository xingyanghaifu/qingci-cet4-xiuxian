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
