-- ===========================================================================
--  多租户 SaaS 后端 · 数据表结构 (SQLite / node:sqlite)
--
--  设计要点
--  1. 一切业务数据都挂在 tenant_id 下（租户 = 工作区/组织），用户通过
--     memberships 与租户建立多对多关系，同一用户可属于多个租户。
--  2. 订阅是「租户级」的，不是用户级：付费主体是工作区，成员共享权益。
--  3. 时间统一存 ISO 8601 UTC 字符串（可直接字典序比较，也便于排查）。
--  4. 所有来自支付网关的写入都以「事件去重表 + 幂等键」兜底，重复投递安全。
--  5. 金额用字符串存展示金额（与 Waffo Pancake 约定一致，如 "9.99"），
--     另存整数分 amount_minor 供聚合统计使用，避免浮点误差。
-- ===========================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 用户与身份
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,              -- USR_xxx
  email             TEXT NOT NULL,                 -- 统一小写存储
  email_verified_at TEXT,                          -- 邮箱验证时间；Google 登录视为已验证
  password_hash     TEXT,                          -- scrypt 哈希；纯 Google 用户为 NULL
  name              TEXT,
  avatar_url        TEXT,
  locale            TEXT,
  is_disabled       INTEGER NOT NULL DEFAULT 0,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- 第三方登录绑定：一个用户可绑定多个 provider
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,               -- 'google'
  provider_account_id TEXT NOT NULL,               -- Google sub
  email               TEXT,
  profile_json        TEXT,
  created_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_account
  ON oauth_accounts (provider, provider_account_id);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts (user_id);

-- ---------------------------------------------------------------------------
-- 租户（工作区）与成员
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id             TEXT PRIMARY KEY,                 -- TNT_xxx
  slug           TEXT NOT NULL,                    -- URL 友好标识，全局唯一
  name           TEXT NOT NULL,
  is_personal    INTEGER NOT NULL DEFAULT 0,       -- 注册时自动创建的个人工作区
  billing_email  TEXT,                             -- 收据接收邮箱，可为空则用 owner 邮箱
  created_by     TEXT REFERENCES users (id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT                              -- 软删除
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

-- 用户 ↔ 租户 的关系表，role 决定权限
CREATE TABLE IF NOT EXISTS memberships (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique ON memberships (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);

-- 邀请链接：token 只存哈希，明文仅出现在邀请邮件里
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash  TEXT NOT NULL,
  invited_by  TEXT REFERENCES users (id),
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users (id),
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_tenant ON invites (tenant_id);

-- ---------------------------------------------------------------------------
-- 会话与一次性令牌
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,               -- SES_xxx
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  active_tenant_id TEXT REFERENCES tenants (id) ON DELETE SET NULL,
  token_hash       TEXT NOT NULL,                  -- sha256(token)，明文只存在于 cookie
  user_agent       TEXT,
  ip               TEXT,
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  revoked_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 邮箱验证 / 找回密码 的一次性令牌
CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_tokens_hash ON email_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens (user_id, kind);

-- OAuth 授权过程中的临时 state（防 CSRF + PKCE 校验）
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_to   TEXT,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 套餐与订阅（Waffo Pancake 侧）
-- ---------------------------------------------------------------------------

-- 技能目录：由 src/data/skills.json 首次启动时播种
CREATE TABLE IF NOT EXISTS skills (
  slug         TEXT PRIMARY KEY,                   -- bs-linear-agent-style-launch-video
  title        TEXT NOT NULL,
  summary      TEXT,
  output       TEXT NOT NULL,                      -- Web | Slides | Video | Image
  is_free      INTEGER NOT NULL DEFAULT 0,
  is_new       INTEGER NOT NULL DEFAULT 0,
  installs     INTEGER NOT NULL DEFAULT 0,
  bookmarks    INTEGER NOT NULL DEFAULT 0,
  preview_url  TEXT,                               -- /assets/skills/<slug>/media/preview-1.webp
  video_url    TEXT,                               -- /previews/<slug>.mp4, resolved via MEDIA_BASE_URL
  gallery_json TEXT NOT NULL DEFAULT '[]',         -- ordered detail-page preview images
  version      TEXT,
  placeholder  TEXT,                               -- 预览图加载前的占位色
  tools_json   TEXT NOT NULL DEFAULT '[]',         -- [{name, src}]
  shelves_json TEXT NOT NULL DEFAULT '[]',         -- 出现在哪些货架/分组
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_output ON skills (output, installs DESC);
CREATE INDEX IF NOT EXISTS idx_skills_free ON skills (is_free, installs DESC);

-- 技能包下载审计：谁在什么时候下载了哪个版本
CREATE TABLE IF NOT EXISTS skill_downloads (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users (id) ON DELETE SET NULL,
  skill_slug  TEXT NOT NULL REFERENCES skills (slug) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  authored    INTEGER NOT NULL DEFAULT 0,   -- 1 = 使用真实 pack 目录，0 = 元数据生成
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_downloads_tenant
  ON skill_downloads (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_downloads_skill
  ON skill_downloads (skill_slug, created_at DESC);

-- 套餐目录：本地 code 与 Pancake 商品 ID 的映射
CREATE TABLE IF NOT EXISTS plans (
  code               TEXT PRIMARY KEY,             -- free | pro_monthly | pro_yearly | lifetime
  name               TEXT NOT NULL,
  description        TEXT,
  product_type       TEXT NOT NULL CHECK (product_type IN ('subscription', 'onetime')),
  billing_period     TEXT,                         -- monthly | yearly | quarterly | weekly (订阅商品)
  amount             TEXT NOT NULL,                -- 展示金额字符串 "9.99"
  currency           TEXT NOT NULL,                -- ISO 4217
  tax_category       TEXT NOT NULL,                -- saas | digital_goods | ...
  trial_days         INTEGER NOT NULL DEFAULT 0,
  features_json      TEXT NOT NULL DEFAULT '[]',   -- 前端展示用的权益清单
  pancake_product_id TEXT,                         -- PROD_xxx，由 setup 脚本回写
  is_active          INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  synced_at          TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- 订阅：租户当前/历史的订阅记录
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,           -- SUB_xxx
  tenant_id            TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan_code            TEXT NOT NULL REFERENCES plans (code),
  provider             TEXT NOT NULL DEFAULT 'waffo_pancake',
  provider_order_id    TEXT,                       -- ORD_xxx（Pancake 订单 ID）
  provider_customer    TEXT,                       -- buyerIdentity（这里用租户 ID）
  status               TEXT NOT NULL CHECK (status IN
                         ('pending', 'active', 'canceling', 'past_due',
                          'canceled', 'expired', 'closed')),
  quantity             INTEGER NOT NULL DEFAULT 1,
  current_period_start TEXT,
  current_period_end   TEXT,                       -- 一次性买断为 NULL
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  trial_ends_at        TEXT,
  started_at           TEXT,
  ended_at             TEXT,
  canceled_at          TEXT,
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_order
  ON subscriptions (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions (tenant_id, status);

-- 支付流水：每一次成功/失败的扣款
CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,            -- PAY_xxx
  tenant_id           TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subscription_id     TEXT REFERENCES subscriptions (id) ON DELETE SET NULL,
  plan_code           TEXT REFERENCES plans (code),
  provider            TEXT NOT NULL DEFAULT 'waffo_pancake',
  provider_order_id   TEXT,                        -- ORD_xxx
  provider_payment_id TEXT,                        -- 支付渠道流水号
  kind                TEXT NOT NULL CHECK (kind IN ('subscription', 'onetime', 'refund')),
  status              TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded')),
  amount              TEXT NOT NULL,               -- 展示金额
  amount_minor        INTEGER NOT NULL DEFAULT 0,  -- 最小货币单位，便于统计
  tax_amount          TEXT,
  currency            TEXT NOT NULL,
  product_name        TEXT,
  buyer_email         TEXT,
  mode                TEXT,                        -- test | prod
  raw_json            TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (provider_order_id);

-- ---------------------------------------------------------------------------
-- Webhook 投递记录（幂等 + 审计）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  delivery_id  TEXT PRIMARY KEY,                   -- event.id（投递 ID），天然幂等键
  provider     TEXT NOT NULL DEFAULT 'waffo_pancake',
  event_type   TEXT NOT NULL,
  event_id     TEXT,                               -- 业务事件 ID
  tenant_id    TEXT,                               -- 归属租户；用于租户级查询与隔离
  mode         TEXT,                               -- test | prod
  store_id     TEXT,
  payload_json TEXT NOT NULL,
  signature_ok INTEGER NOT NULL DEFAULT 1,
  received_at  TEXT NOT NULL,
  processed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON webhook_events (tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- 审计日志
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT REFERENCES tenants (id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action        TEXT NOT NULL,                     -- auth.login / tenant.invite / billing.checkout ...
  target_type   TEXT,
  target_id     TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip            TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_user_id, created_at DESC);
