# Skillry backend · 多租户 SaaS 后端

本地可运行的多租户后端：**邮箱 + Google 登录**、**工作区（租户）与成员权限**、
**Waffo Pancake 订阅支付**。TypeScript 直跑（Node 24 原生类型擦除），
数据库用 Node 内置 `node:sqlite`，运行时依赖只有 `express` 和 `@waffo/pancake-ts`。

```bash
npm install
cp .env.example .env      # 然后填入 WAFFO_PRIVATE_KEY（见下方第 1 步）
npm start                 # http://localhost:8787  打开就是调试台
```

## 0 · 状态

| 项目 | 状态 |
| --- | --- |
| 启动、注册、登录、会话、租户隔离 | ✅ 已跑通（27 项 HTTP 冒烟测试） |
| 订阅状态机（激活/续费/取消/退款…) | ✅ 已跑通（32 项断言，合成事件驱动） |
| **前端 ↔ 后端** | ✅ **已打通**：复刻站点直接由后端在 `/` 提供，登录/订阅/目录全部走真实接口 |
| 技能目录（数据库） | ✅ 56 个技能入库，支持搜索与 Web/Slides/Video/Image/Free 筛选 |
| **技能包分发** | ✅ 权益校验 → 签名短链 → 真实 ZIP；下载审计与安装计数已接 |
| 邮箱登录 | ✅ 可用（开发模式邮件打到控制台，不发外网） |
| Google 登录（代码逻辑） | ✅ 已跑通（21 项，假 Google 端到端，含 PKCE / state 重放 / 账号合并） |
| Google 登录（真实凭据） | ✅ 已填入 `.env`；授权跳转已验证，真实往返需在有 Google 出口的机器上点一次 |
| **Pancake 收银台** | ✅ **已连通真实测试环境**，3 个商品已创建，真实 checkout 会话已验证可打开 |
| 取消订阅 / 客户门户 | ⚠️ 代码就绪，等有真实订阅单后即可验证 |
| Webhook 收到真实回调 | ⚠️ 需要公网隧道（见 1.3），本机 localhost 收不到 |
| Webhook 验签 | ✅ 未签名请求返回 401；已用官方内置公钥验签，无需自建密钥 |

> 私钥不要发到聊天里。本机已经装好了，见下一节；`.env` 和 `keys/` 都在 `.gitignore` 中。

### 打开之后能看到什么

| 路由 | 内容 |
| --- | --- |
| `/` | 复刻的完整首页；右上角是真实的登录态，定价区按钮直连 Pancake 收银台 |
| `/skills` | 由数据库渲染的技能目录（`?q=` 搜索、`?output=` 筛选、`?free=1`） |
| `/skills/<slug>` | 技能详情页：预览图、统计、可用性判断、订阅 CTA |
| `/pricing` | 302 到首页定价区 |
| `/dev` | 原来的调试台（发信箱、webhook 记录、开发授权） |
| `/health`、`/api/*` | 健康检查与 JSON API |

## 1 · 配置 Waffo Pancake

### 1.1 本机当前状态（已装好）

私钥从 `D:\内容生产\.env`（`# waffo pancake apikey` 下面那行）取出，那是一个 **1624 字符的裸 base64
PKCS#8 私钥**（没有 PEM 头）。已转换并安装为：

```
keys/pancake-private.pem        # 2048-bit RSA，PEM 格式
.env → WAFFO_PRIVATE_KEY_FILE=./keys/pancake-private.pem
```

转换前用 Node 的 `crypto.createPrivateKey()` 验过能正常解析（指纹 `d6a5e873e6607e3b`）。

> 注意：私钥现在存在于两处 —— 你的 `D:\内容生产\.env` 和本项目的 `keys/pancake-private.pem`。
> 如果不想留副本，可以把 `WAFFO_PRIVATE_KEY_FILE` 指向任意单一位置，然后删掉多余那份。

### 1.2 三种写法（换机器时用）

```dotenv
# A. 直接内联（注意 \n 转义）
WAFFO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----"

# B. base64（推荐，适合 CI）
WAFFO_PRIVATE_KEY_BASE64=LS0tLS1CRUdJTi...

# C. 指向本地 .pem 文件（当前用法）
WAFFO_PRIVATE_KEY_FILE=./keys/pancake-private.pem
```

裸 base64 也直接可用（SDK 会自动规范化 PEM 头、`\n`、Windows 换行）。

### 1.3 目录初始化（已执行）

幂等，可重复执行：

```bash
npm run pancake:setup
```

它会：

1. 用 GraphQL 列出商户下的店铺 —— 有 `WAFFO_STORE_ID` 就用它；只有一家自动选中；多家则**报错要求你显式指定**，不会瞎猜（照官方 skill 的规则）。
2. **先复用、再创建**：按商品名匹配店铺里已有的商品，命中就复用（不会重复建）；没有才新建，并把 `PROD_…` 写回本地 `plans` 表。
3. 把两个订阅商品挂进一个商品组（共享试用 + 支持自助升降档）。
4. 注册 HTTP webhook 到 `APP_URL/api/webhooks/waffo` —— 但 `APP_URL` 是 localhost 时**默认跳过**（Pancake 访问不到，建了也是死条目），并提示你用隧道。
5. 打印测试卡号提示。

本次实际创建的资源（test 模式）：

| 套餐 | 类型 | Pancake 商品 ID |
| --- | --- | --- |
| Pro Monthly (9.99 USD/月) | subscription | `PROD_0vlrBUJ5FZbaEB3l5PGFze` |
| Pro Yearly (79.00 USD/年) | subscription | `PROD_2siOmTOiQrA24CszlDHKEB` |
| Founding Lifetime (169.00 USD 一次) | onetime | `PROD_1haaRz2rSubBwXprV6vGVs` |

订阅商品组：`c525172a-cf48-4154-8b4b-134f6e309ffc`。
店铺里原有的 `lite`（monthly，`PROD_71cwU1K6YgHyPdEhD0QmCz`）**没有被改动** —— 它不在
[`src/billing/plans.ts`](src/billing/plans.ts) 的目录里。想把它纳入，就在那个文件里加一条
`code: "lite"` 的套餐并填上这个 product id，重启即可。

改价格 / 改名字：编辑 `src/billing/plans.ts` 后重跑 `npm run pancake:setup`
（同名商品会复用，不会新建；Pancake 的商品更新走 `update()` 生成新版本）。

```bash
npm run pancake:refresh                            # 对照检查：店铺/商品/webhook/本地映射
npm run pancake:setup -- --publish                 # 把测试版本发布到生产
npm run pancake:setup -- --no-webhook              # 明确不注册 webhook
npm run pancake:setup -- --force-webhook           # 即使是 localhost 也注册
```

### 收银台与 Webhook

- 创建会话：`client.checkout.createSession({ productId, currency, buyerEmail, successUrl, orderMerchantExternalId, metadata })`
  其中 `orderMerchantExternalId = "<tenantId>:<planCode>"`，订单、支付、退款都会继承它，对账很方便。
- 前端**必须新开标签页**跳转 `checkoutUrl`（官方明确禁止用 `location.href`），调试台就是这么做的。
- Webhook 用 `express.raw()` 收原始 body，`verifyWebhook(rawBody, "x-waffo-signature")` 验签；
  SDK 内置了 test/prod 公钥，不需要你配。**千万不要**在这一条路由上挂 `express.json()`。
- 投递是 at-least-once，用 `event.id`（投递 ID）做幂等键写入 `webhook_events`，重复投递直接 200 返回。
- 本地收不到 webhook：Pancake 访问不到 localhost，用 `ngrok http 8787` 拿公网地址，再
  `npm run pancake:setup -- --webhook-url=https://xxx.ngrok-free.app/api/webhooks/waffo`。
  别用 localtunnel —— 它会丢掉 `X-Waffo-Signature` 头。

  当前项目**还没有注册 webhook**（`webhooks: 0`）—— 这是刻意的：本机地址 Pancake 打不通，
  注册了只会留个死条目。等你要联调回调时按上面两步走；临时用 `--force-webhook` 可以强制注册。

### 事件 → 订阅状态映射

| Pancake 事件 | 本系统动作 |
| --- | --- |
| `order.completed` | 一次性买断（Lifetime）→ 建订阅行 `active`、无到期日；写支付流水 |
| `subscription.activated` | `active` + 记录账期起止 |
| `subscription.payment_succeeded` | 记录续费流水；关联订阅置 `active` |
| `subscription.renewed` / `recovered` | `active`，刷新账期 |
| `subscription.canceling` | `canceling` + `cancel_at_period_end=1`（**期间内权益保留**） |
| `subscription.uncanceled` | 回到 `active`，清除 `cancel_at_period_end` |
| `subscription.past_due` | `past_due`，在宽限期（默认 7 天）内仍放行 |
| `subscription.canceled` | `canceled`，写 `ended_at`，立刻收回权益 |
| `refund.succeeded` / `failed` | 写退款流水；成功退款同时终止对应权益 |

事件里没带租户信息的（正常不会发生）会被记成 `ignored` 而不是写脏数据，并返回 200 避免无限重投。

### 测试卡号（test 模式）

| 结果 | 卡号 |
| --- | --- |
| 成功 | `4576 7500 0000 0110` |
| 失败 | `4576 7500 0000 0220` |

有效期任意、CVC 任意。另外 `4576 7500 0000 0120` 之类的变体可用来看更多分支。

## 2 · 配置 Google 登录

### 2.1 你要做的事（一次性，约 3 分钟）

1. 打开 [Google Cloud Console](https://console.cloud.google.com/) → 顶部项目选择器 → **新建项目**（名字随意，比如 `skillry-dev`）。
2. 左侧菜单 → **API 和服务** → **OAuth 同意屏幕**：
   - User Type 选 **外部** → 创建
   - 应用名称、用户支持邮箱、开发者联系邮箱随便填
   - **范围**这一步：直接「保存并继续」，不用手动加
   - **测试用户**这一步：**把你自己的 Google 邮箱加进去**（关键，见下面的坑）
   - 保存
3. 左侧菜单 → **API 和服务** → **凭据** → **创建凭据** → **OAuth 客户端 ID**：
   - 应用类型必须选 **Web 应用**（选错会报 `unsupported_response_type`）
   - 名称随意
   - **已获授权的重定向 URI** → 添加 URI → 粘贴：

     ```
     http://localhost:8787/auth/google/callback
     ```

   - 创建，弹窗里会出现 **客户端 ID** 和 **客户端密钥**
4. 把这两个值填进 `outputs/skillry-backend/.env`：

   ```dotenv
   GOOGLE_CLIENT_ID=1234567890-xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
   ```

   `GOOGLE_REDIRECT_URI` 不用改：它默认从 `APP_URL` 推导，已经是上面那个地址。
5. 回到项目目录跑预检，然后重启服务：

   ```bash
   npm run google:check      # 会直接告诉你三个值配没配对
   npm start
   ```

6. 打开 `http://localhost:8787`，点「用 Google 登录」。

### 2.2 三个最常见的坑

| 现象 | 原因 / 解决 |
| --- | --- |
| `Error 403: access_denied` | 同意屏幕还是「测试」状态，而你的账号不在**测试用户**名单里。加上即可（第 2 步）。 |
| `Error 400: redirect_uri_mismatch` | 回调地址没登记或不完全一致。协议、端口、结尾斜杠都算不同地址。改完等 1–5 分钟生效。把 `npm run google:check` 打印出来的那行原样粘过去。 |
| `invalid_client` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 写错、带空格，或把「客户端 ID」和「密钥」搞反了。 |
| 回调页显示 `google_unreachable`（或早期版本的 `internal_error`） | **服务端连不上 Google**，授权码换不了 token。浏览器能打开 Google 不代表服务器也能。设 `OUTBOUND_PROXY_URL`，或把后端部署到能访问 Google 的机器。日志里对应 `[error] fetch failed`。 |
| 登录成功跳回后仍显示「未登录」 | 地址用了 `127.0.0.1` 而不是 `localhost`，两者 Cookie 不互通。统一用 `http://localhost:8787`。 |

### 2.3 服务端必须能直连 Google

**token 交换和拉取用户信息都是服务端发起的**，所以跑这个服务的机器自己必须能访问
`accounts.google.com` 和 `oauth2.googleapis.com` —— 只给浏览器翻墙没用。

在国内或受限网络里，二选一：

- 把后端部署到能访问 Google 的机器（海外 VPS）；
- 给服务端配代理：

  ```dotenv
  OUTBOUND_PROXY_URL=http://127.0.0.1:7890
  ```

  Node 自带的 `fetch` **不认** `HTTPS_PROXY`/`HTTP_PROXY`，所以必须用这个变量；
  项目用 undici 的 `ProxyAgent` 把它接进了 Google 调用和 Pancake 调用（`WaffoPancake`
  支持自定义 fetch）。启动横幅会打印当前出网方式，方便确认。

### 2.4 实现细节

标准授权码 + PKCE（S256）流程：

1. `GET /auth/google` 生成随机 `state` 与 `code_verifier`，存库（10 分钟过期、一次性），
   跳转到 Google，带 `scope=openid email profile` 与 `code_challenge`。
2. 回调校验 `state` 后立即删除（**重放直接 400**），用 `code_verifier` 换取 token。
3. 拉 userinfo → 按 `sub` 找绑定；没有就按**已验证邮箱**合并到已有账号，否则新建用户并
   自动创建一个个人工作区（`createWorkspaceForOwner()` 保证「建工作区」和「加 owner 成员」
   永远成对发生）。
4. **Google 标记为未验证的邮箱一律拒绝**，避免把未验证邮箱合并进已有密码账号（账号接管风险）。
5. 建会话 → 跳回 `next`（只接受同源相对路径，防开放重定向）。

### 2.5 离线验证（不需要 Google 凭据）

```bash
npm run test:google     # 21 项，用内置的假 Google 跑完整流程
```

测试会真的启动一个「假 Google」HTTP 服务，并把应用的 `GOOGLE_*_ENDPOINT` 指过去，
然后完整走一遍跳转 → 授权 → 回调 → 建会话，覆盖：

PKCE challenge/verifier 真的校验、`state` 重放被拒、同一 Google 账号二次登录不重复建号、
邮箱已验证时才合并到密码账号、未验证邮箱被拒、用户拒绝授权时正确回跳。

## 3 · 数据表结构

全部定义在 [`src/schema.sql`](src/schema.sql)（含逐表中文注释）。要点：

```
users ──┬── oauth_accounts          第三方登录绑定（provider + sub 唯一）
        ├── sessions                会话（cookie 只存明文 token，库里存 sha256）
        ├── email_tokens            邮箱验证 / 重置密码（一次性，存哈希）
        └── memberships ──┐
                          │
        tenants ──────────┘         多对多：一个用户可属于多个租户，role = owner/admin/member
           ├── invites              邀请（token 存哈希，明文只出现在邮件里）
           ├── subscriptions        租户级订阅（provider_order_id 唯一）
           ├── payments             支付流水（含 amount_minor 便于聚合）
           └── audit_log            审计

plans                套餐目录：本地 code ↔ Pancake PROD_… 的映射
webhook_events       Webhook 投递账本（delivery_id 主键 = 幂等键，带 tenant_id 便于租户级查询）
oauth_states         OAuth 过程中临时的 state + PKCE verifier
skills               技能目录（slug 主键，输出类型/免费标记/统计/工具）
skill_downloads      下载审计：谁、哪个租户、哪个版本、是否使用真实 pack
```

几个刻意的设计选择：

- **订阅挂在租户而不是用户身上**：付钱的是工作区，成员共享权益；用户换工作区时权益跟着走。
- **金额存字符串**（`"9.99"`，与 Pancake 一致），另存整数分 `amount_minor` 供统计，避免浮点误差。
- **时间统一 ISO 8601 UTC 字符串**，字典序即时间序，排查问题直接看。
- **一切支付写入都有幂等兜底**（`webhook_events.delivery_id` 主键 + `ON CONFLICT DO NOTHING`）。
- **schema 幂等 + 轻量变更**：`CREATE TABLE IF NOT EXISTS` 保证可重复执行，后加的列由
  [db.ts](src/db.ts) 里的 `ensureColumn()` 按 `PRAGMA table_info` 补，老库无需重建。

## 4 · 租户隔离规则

这是多租户后端最容易出事的地方，实现上守三条：

1. 租户 ID 只从**服务端会话**推导（`session.active_tenant_id`），绝不信任请求体里的 tenant 字段。
   客户端可以用 `X-Tenant-Id` 头切租户，但服务端一定会再查一次 `memberships`，不是成员就 403。
2. 所有租户级查询都带 `WHERE tenant_id = ?` 参数（见 `src/repos/billing.ts`）。
3. 危险操作按角色收紧：发起结账/取消订阅需要 `owner` 或 `admin`；改成员角色、删工作区只有 `owner`；
   最后一个 owner 不能被降级或移除（防止工作区变成孤儿）。

顺带修掉的一个坑：Webhook 记录接口原本返回全局投递列表（跨租户元数据泄露），现在
`webhook_events.tenant_id` + 强制 `requireTenant` 过滤。

## 5 · API 一览

页面（服务端渲染，带同一套 header/footer）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 首页（静态 HTML + `site.js` 注入登录态） |
| GET | `/skills` | 目录页，支持 `q` / `output` / `free` |
| GET | `/skills/:slug` | 详情页；按当前会话决定 CTA（订阅 / 登录 / 已可用） |
| GET | `/pricing` | 302 → `/#pricing` |
| GET | `/dev` | 调试台 |

认证（`/api`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 邮箱注册，建用户 + 工作区（可带 `inviteToken` 直接接受邀请） |
| POST | `/auth/login` | 邮箱密码登录（错误信息不区分账号是否存在，防枚举） |
| POST | `/auth/logout` · `/auth/logout-all` | 退出当前 / 全部会话 |
| GET | `/auth/me` | 当前用户 + 所属租户 + 当前租户 + 角色 |
| POST | `/auth/active-tenant` | 切换当前工作区 |
| POST | `/auth/verify-email` · `/auth/resend-verification` | 邮箱验证 |
| POST | `/auth/forgot-password` · `/auth/reset-password` | 重置密码（重置后踢掉所有会话） |
| POST | `/auth/accept-invite` | 接受邀请加入工作区 |
| GET | `/auth/google` · `/auth/google/callback` | Google OAuth |

工作区：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/tenants` | 我的工作区列表 / 新建 |
| GET/PATCH/DELETE | `/tenants/current` | 读取 / 改名 / 软删除 |
| GET | `/tenants/current/members` | 成员 + 待处理邀请 |
| POST | `/tenants/current/invites` | 发邀请（返回 `devInviteUrl` 方便本地测试） |
| PATCH/DELETE | `/tenants/current/members/:userId` | 改角色 / 移除成员 |

账单：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/billing/plans` | 套餐列表（含 `ready` 表示是否已在 Pancake 建好） |
| GET | `/billing/entitlements` | 当前租户是否有权益 + 原因 |
| GET | `/billing/subscription` | 当前订阅详情 |
| POST | `/billing/checkout` | 创建收银台会话，返回 `checkoutUrl` |
| POST | `/billing/cancel` | 取消订阅（期末生效） |
| POST | `/billing/portal` | 客户门户免登录链接 |
| GET | `/billing/payments` | 支付流水 |
| GET | `/billing/webhook-events` | 本租户的 webhook 记录 |
| POST | `/api/webhooks/waffo` | Pancake 回调（原始 body + 验签） |

目录：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/skills` | `q` / `output` / `free` / `sort` / `limit` / `offset` |
| GET | `/api/skills/:slug` | 单个技能 |
| POST | `/api/skills/:slug/download` | 校验权益，返回 15 分钟有效的签名下载地址 |
| GET | `/api/downloads/:token` | 校验签名，流式返回技能包 ZIP |

开发专用（`NODE_ENV != production`）：`GET/DELETE /api/dev/outbox`（开发收件箱）、
`POST /api/dev/grant`（不经过支付直接授予权益，方便调 UI）。

## 6 · 测试

```bash
npm run test:billing   # 32 项：账单状态机 + 权益 + 租户归属（临时库，不碰你的数据，不需要网络）
npm start              # 另开一个终端
npm run test:api       # 27 项：注册/登录/租户/权限/幂等/验签 全链路
```

`test:billing` 直接调 `applyWebhookEvent()` 喂合成事件，所以不需要 Pancake 凭据也能验证
激活→续费→取消→退款的状态迁移；`test:api` 覆盖 HTTP 层，包括「未签名 webhook → 401」。

两个可选开关：

```bash
TEST_LIVE=1     npm run test:billing   # 额外打一次真实 API，验证错误映射（422/404 会包成 HttpError）
TEST_CHECKOUT=1 npm run test:api       # 额外创建一次真实收银台会话（会在 Pancake 留一条会话记录）
npm run test:google                    # Google 流程（用假 Google，不需要凭据也不需要网络）
npm run google:check                   # 真实凭据预检（需要网络，会告诉你三个值配没配对）
```

`TEST_CHECKOUT` 跑通过一次，返回的 `checkoutUrl` 形如
`https://pancake.waffo.ai/store/<店铺>/checkout/cs_<uuid>`，页面可正常打开（HTTP 200）。

## 7 · 目录结构

```
src/
  server.ts            应用装配（webhook 路由必须挂在 express.json 之前）
  config.ts            环境变量解析 + 私钥三种来源 + 启动摘要（脱敏）
  db.ts                node:sqlite 连接、迁移、事务helper
  schema.sql           全部表结构（中文注释）
  data/skills.json     技能目录种子（首次启动自动灌库）
  lib/                 ids · secrets(scrypt/PKCE) · errors · http(cookie) · validate · audit · mailer
  auth/                sessions · middleware · google · routes
  tenants/routes.ts    工作区、成员、邀请
  billing/             pancake(SDK 封装) · plans(目录) · seed · routes · webhook(状态机)
  repos/               users · tenants · billing · skills —— 所有 SQL 集中在这里
  web/                 layout(复用首页 header/footer) · pages(目录页/详情页) · routes
scripts/               pancake-setup · pancake-refresh · db-reset · test-billing · test-google · smoke-api
public/
  index.html           复刻首页（build-site 生成，含登录槽与定价按钮钩子）
  assets/              站点样式/脚本/图片 + app-extras.css + site.js（应用层）
  dev.html             零依赖调试台
```

## 8 · 上线前要做的事

- `SESSION_SECRET` 必须设置（生产不给默认值）；换 HTTPS 后把 `COOKIE_SECURE=true`。
- 按 2.3 确认**服务端**能访问 Google；不能就配 `OUTBOUND_PROXY_URL`，或把 Google 登录
  换成不依赖境外网络的方式（微信/手机号）。上线前先跑一次 `npm run google:check`。
- OAuth 同意屏幕从「测试」切到「生产」需要 Google 审核（有敏感范围时更久）；测试阶段
  记得维护测试用户名单，否则同事登录会 403。
- `lib/mailer.ts` 现在是开发投递器（只打日志 + 内存收件箱）。接真实邮件服务只需替换
  `sendMail()` 内部实现 —— 它是整个项目里唯一发信出口。
- 登录/注册/重置密码都还没有限流。上线前加一层 IP + 账号维度的速率限制。
- `express.json({ limit })` 已限制请求体，反向代理层再补一档更严的上限。
- 测试模式和生产模式要用**两把不同的 API Key**（官方明确要求），`WAFFO_ENVIRONMENT` 跟着切。
- 数据库目前是单文件 SQLite。要横向扩展就换 Postgres：SQL 都集中在 `src/repos/`，替换成本可控。

## 9 · 已知缺口

- 没有前端产品界面，只有调试台（`public/index.html`）。前端可以直接复用现有的 Skillry 复刻页面。
- 目录页的分类筛选只有 `output` 是真实的；`use-case` / `role` 标签还没进库，
  首页分类菜单暂时都落到完整目录。
- 还没有真正的 CLI（`skillry add <slug>`）。下载链接本身已经是签名短链，CLI 可以直接复用。
- 技能包的版本只有 `1.0.0` 一档，没有"更新推送/版本历史"。
- Google 账号目前只用于登录，没有做「已登录用户在设置页绑定/解绑 Google」的界面；
  绑定是登录时按已验证邮箱自动完成的。解绑需要额外做一个接口（删除 `oauth_accounts` 行，
  并保证用户仍有密码可登录）。
- 没有「降档/升档」按钮，只有 Pancake 的客户门户（`/billing/portal`）里自助改。
  需要站内改档就调 `client.checkout.createPlanChangeSession()`，SDK 已支持，我留了接口没接。
- 没有用量计费/信用点。要加就走「一次性商品 + `priceSnapshot` 动态定价」那条路。
- 组织层级只有一层（租户 → 成员），没有子团队。

## 10 · 技能包分发

下载是真实的，不是占位：

1. POST /api/skills/:slug/download —— 校验登录 + 工作区 + 权益（免费技能只要求登录，Pro 技能要求该租户有生效订阅），通过后签发一个 **HMAC 签名、15 分钟过期** 的地址。
2. GET /api/downloads/<token> —— 验签、复查权益，现场生成 ZIP，写 skill_downloads 审计，并把 skills.installs 加一。

### 放真实内容

`
packs/<slug>/
  SKILL.md
  templates/...
`

只要这个目录存在，打包时就会**原样收录**其中所有文件（子目录保留）。没有目录时，用目录元数据生成一份脚手架：

| 文件 | 内容 |
| --- | --- |
| SKILL.md | YAML frontmatter（name / description / version / tier / output）+ 使用说明骨架 |
| manifest.json | 机器可读元数据，generatedFrom: catalog-metadata |
| README.md | Claude Code / Codex / Cursor 三个安装路径 |

ZIP 由 [src/lib/zip.ts](src/lib/zip.ts) 现写（deflate，零第三方依赖）。测试里用 Python 的 zipfile 反解并 	estzip() 校验过，不是自己验自己。

`ash
npm run test:pack    # 10 项：票据签发、ZIP 字节、Pro 拦截、伪造/篡改签名、匿名下载
`
