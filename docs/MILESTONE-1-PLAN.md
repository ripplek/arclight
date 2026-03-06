# Milestone 1 — 基础项目搭建：详细执行与验收计划

> **目标**：从"脚手架已就位"到"可以注册、登录、看到 Dashboard、Docker 能构建"。
>
> **完成标志**：端到端流程跑通——`npm install` → `npm run dev` → 注册账号 → 登录 → 看到 Dashboard → health check 200 → Docker 构建成功。

---

## 依赖关系总览

```
A1 → A2 → A3 (环境初始化，串行)
     ↓
  ┌──┴──────────────┐
  B1→B2→B3          E1 (数据库 & shadcn 可并行)
  ↓                  ↓
  C1→C2→C3          E2→E5 (API client)
  ↓                  ↓
  D1→D2             E3→E4 (页面)
  ↓                  ↓
  ├──────────────────┤
  F1→F2 (Docker)
  ↓
  G1 (整体验收)
```

**可并行的组**：
- B 组（数据库）和 E1（shadcn 初始化）可以并行
- D 组（API）和 E2-E5（前端页面）可以在各自依赖就绪后并行

---

## A. 环境初始化

### A1. npm install 跑通

**目标**：所有 workspace 依赖安装成功，无报错。

**操作步骤**：

1. 在项目根目录执行：
```bash
cd ~/projects/arclight
npm install
```

2. 如果 `better-sqlite3` 编译失败（常见于 macOS），确保已安装 build tools：
```bash
# macOS
xcode-select --install
# 或者用 prebuild
npm rebuild better-sqlite3
```

3. 需要额外安装的根级 devDependencies（补充缺失的）：
```bash
npm install -D @types/node
```

**验收**：
```bash
# 无报错完成
npm ls --depth=0

# 检查关键包存在
ls node_modules/hono node_modules/better-sqlite3 node_modules/drizzle-orm node_modules/better-auth
# 均应存在
```

---

### A2. TypeScript 编译通过

**目标**：`tsc --build` 全量编译无错误。

**操作步骤**：

1. 先测试编译：
```bash
npm run typecheck
```

2. **已知问题修复**：

   **2a.** `packages/shared/src/types/feed.ts` 中 `FeedAdapter.fetch()` 的参数签名需要与 `packages/backend/src/engine/adapters/google-news.ts` 对齐。当前 `FeedAdapter` 接口定义的 `fetch` 参数是 `{ url: string; name: string; type: string }`，但 `GoogleNewsAdapter.fetch` 接收 `{ url: string; name: string; type: string; fetchConfig?: { query?: string } }`。

   **修复方案**：扩展 `FeedAdapter` 接口的 `source` 参数：
   ```typescript
   // packages/shared/src/types/feed.ts
   export interface FeedAdapter {
     type: string;
     supports(source: { type: string; url: string }): boolean;
     fetch(
       source: {
         url: string;
         name: string;
         type: string;
         fetchConfig?: Record<string, unknown>;  // 扩展为通用 config
       },
       options: FetchOptions,
     ): Promise<RawFeedItem[]>;
   }
   ```

   **2b.** `supports()` 方法参数中 `url` 是必需的，但 Google News 类型的 source 可能没有 `url`（只有 `fetchConfig.query`）。修改为：
   ```typescript
   supports(source: { type: string; url?: string }): boolean;
   ```

3. 重新编译验证：
```bash
npm run typecheck
```

**验收**：
```bash
npm run typecheck
# 退出码 0，无错误输出
echo $?
# 0
```

---

### A3. `npm run dev` 能同时启动 backend + frontend

**目标**：一条命令启动后端 (port 3000) 和前端 (port 5173)。

**操作步骤**：

1. 创建 `.env` 文件（从 `.env.example` 复制）：
```bash
cp .env.example .env
```

2. 编辑 `.env`，填入最小必须值：
```env
SESSION_SECRET=arclight-dev-secret-change-in-prod-32chars
ADMIN_EMAIL=admin@arclight.local
DATABASE_URL=file:./data/arclight.db
LLM_PROVIDER=none
PORT=3000
LOG_LEVEL=debug
```

3. 确保 backend `data/` 目录存在：
```bash
mkdir -p packages/backend/data
```

4. 启动 dev：
```bash
npm run dev
```

5. **已知问题**：backend 启动时会尝试连接 SQLite，但 DB 文件还未创建。`better-sqlite3` 会自动创建文件，但需要确保 `data/` 目录存在。如果 `client.ts` 中的路径 `file:./data/uf.db` 是相对于 CWD 的，需要确认 `tsx watch` 的 CWD 是 `packages/backend/`。

   **修复**：更新 `packages/backend/src/db/client.ts` 中默认路径：
   ```typescript
   const dbUrl = process.env.DATABASE_URL || 'file:./data/arclight.db';
   ```
   > 注意：这只影响默认值，实际由 `.env` 控制。但保持一致性。

**验收**：
```bash
# 终端 1
npm run dev
# 应看到 concurrently 同时输出 backend + frontend 日志

# 终端 2
curl http://localhost:3000/api/health
# 预期输出：{"status":"ok","version":"0.1.0","timestamp":"..."}

# 浏览器访问 http://localhost:5173
# 预期看到：ArcLight Dashboard 占位页
```

---

## B. 数据库

### B1. Drizzle migration 生成 + 执行

**依赖**：A1 完成

**目标**：从 `schema.ts` 生成 SQL migration，并在 SQLite 中创建所有表。

**操作步骤**：

1. **重要**：在生成 migration 之前，需要先处理 better-auth 的 schema 兼容性。better-auth 有自己的 `user` 和 `session` 表结构要求。我们的方案是：**让 better-auth 使用我们已定义的表，通过字段映射适配**（详见 C1）。因此，先调整 schema，再生成 migration。

2. **调整 schema.ts** — 为 better-auth 兼容添加必要字段：

   better-auth (v1.2+) 要求 `user` 表包含以下字段：`id`, `email`, `name`, `emailVerified` (boolean), `image`, `createdAt`, `updatedAt`。
   better-auth 要求 `session` 表包含：`id`, `userId`, `token`, `expiresAt`, `createdAt`, `updatedAt`, `ipAddress`, `userAgent`。
   better-auth 的 `account` 表用于 OAuth（email/password 策略也需要，存储 credential 信息）：`id`, `userId`, `accountId`, `providerId`, `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `idToken`, `password`, `createdAt`, `updatedAt`。
   better-auth 的 `verification` 表用于 email 验证等：`id`, `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`。

   **修改 `packages/backend/src/db/schema.ts`**：

   ```typescript
   import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

   // ═══════════════════════════════════════════
   // Users & Auth (better-auth compatible)
   // ═══════════════════════════════════════════

   export const users = sqliteTable('user', {  // better-auth 默认表名 'user'
     id: text('id').primaryKey(),
     email: text('email').notNull().unique(),
     name: text('name').notNull(),
     emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
     image: text('image'),
     // --- ArcLight custom fields ---
     role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
     timezone: text('timezone').default('UTC'),
     locale: text('locale').default('zh-CN'),
     createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
     updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
   });

   export const sessions = sqliteTable('session', {  // better-auth 默认表名 'session'
     id: text('id').primaryKey(),
     userId: text('userId').notNull().references(() => users.id),
     token: text('token').notNull().unique(),
     expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
     ipAddress: text('ipAddress'),
     userAgent: text('userAgent'),
     createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
     updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
   });

   export const accounts = sqliteTable('account', {
     id: text('id').primaryKey(),
     userId: text('userId').notNull().references(() => users.id),
     accountId: text('accountId').notNull(),
     providerId: text('providerId').notNull(),
     accessToken: text('accessToken'),
     refreshToken: text('refreshToken'),
     accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
     refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
     scope: text('scope'),
     idToken: text('idToken'),
     password: text('password'),
     createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
     updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
   });

   export const verifications = sqliteTable('verification', {
     id: text('id').primaryKey(),
     identifier: text('identifier').notNull(),
     value: text('value').notNull(),
     expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
     createdAt: integer('createdAt', { mode: 'timestamp' }),
     updatedAt: integer('updatedAt', { mode: 'timestamp' }),
   });

   // 其余表保持不变 (feedSources, userSources, feedItems, storyArcs, arcItems, userPreferences, digests, consumption)
   // ...
   ```

   > **关键变更**：
   > - `users` 表名改为 `user`（better-auth 默认）
   > - `sessions` 表名改为 `session`（better-auth 默认）
   > - 列名改为 camelCase（better-auth 默认映射）
   > - 删除 `passwordHash`（better-auth 在 `account` 表管理密码）
   > - 新增 `account` 和 `verification` 表
   > - `sessions` 新增 `ipAddress`, `userAgent`, `updatedAt`
   > - `users` 新增 `emailVerified`
   >
   > **保留的自定义字段**：`role`, `timezone`, `locale`（通过 better-auth 的 `additionalFields` 配置暴露）

3. 更新 `drizzle.config.ts`，确保 URL 一致：
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./data/arclight.db',
  },
});
```

4. 生成 migration：
```bash
cd ~/projects/arclight
npm run db:generate
```

5. 创建 migration 执行脚本 `packages/backend/src/db/migrate.ts`：
```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client.js';

console.log('Running migrations...');
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete.');
```

6. 在 `packages/backend/package.json` 添加 script：
```json
{
  "scripts": {
    "db:migrate:run": "tsx src/db/migrate.ts"
  }
}
```

7. 在根 `package.json` 添加：
```json
{
  "scripts": {
    "db:migrate:run": "npm run db:migrate:run -w packages/backend"
  }
}
```

8. 执行 migration：
```bash
npm run db:migrate:run
```

**验收**：
```bash
# migration 文件已生成
ls packages/backend/drizzle/
# 应有 0000_*.sql 和 meta/ 目录

# 数据库文件已创建
ls packages/backend/data/arclight.db
# 应存在

# 检查所有表已创建
sqlite3 packages/backend/data/arclight.db ".tables"
# 预期输出包含：
# account       arc_items     consumption   digests       feed_items
# feed_sources  session       story_arcs    user          user_preferences
# user_sources  verification
```

---

### B2. 验证所有表字段正确

**依赖**：B1 完成

**操作步骤**：

```bash
# 逐表检查字段
sqlite3 packages/backend/data/arclight.db ".schema user"
sqlite3 packages/backend/data/arclight.db ".schema session"
sqlite3 packages/backend/data/arclight.db ".schema account"
sqlite3 packages/backend/data/arclight.db ".schema feed_sources"
sqlite3 packages/backend/data/arclight.db ".schema feed_items"
sqlite3 packages/backend/data/arclight.db ".schema story_arcs"
sqlite3 packages/backend/data/arclight.db ".schema digests"
sqlite3 packages/backend/data/arclight.db ".schema consumption"
```

**验收**：每张表的字段与 `schema.ts` 定义一致，外键约束存在。

---

### B3. Seed 脚本

**依赖**：B1 完成

**目标**：插入默认 admin 用户 + 从 source-packs YAML 导入 feed sources。

**操作步骤**：

1. 安装 YAML 解析库：
```bash
npm install yaml -w packages/backend
```

2. 创建 `packages/backend/src/db/seed.ts`：

```typescript
import { db } from './client.js';
import { users, accounts, feedSources } from './schema.js';
import { nanoid } from 'nanoid';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../shared/logger.js';

// ── 1. 创建 admin 用户 ──

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@arclight.local';

  // 检查是否已存在
  const existing = db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, adminEmail),
  });

  if (existing) {
    logger.info({ email: adminEmail }, 'Admin user already exists, skipping');
    return existing.id;
  }

  const userId = nanoid();
  const now = new Date();

  db.insert(users).values({
    id: userId,
    email: adminEmail,
    name: 'Admin',
    emailVerified: true,
    role: 'admin',
    timezone: process.env.TZ || 'Asia/Shanghai',
    locale: 'zh-CN',
    createdAt: now,
    updatedAt: now,
  }).run();

  // 为 admin 创建 credential account（密码：arclight123）
  // 注意：better-auth 使用 bcrypt/scrypt hash，这里用它的内置方法更安全。
  // 但 seed 场景下，我们直接插入一个空密码的 account，首次登录时让用户重置。
  // 或者更好的方案：使用 better-auth 的 API 来创建用户。
  //
  // 简化方案：seed 只创建 user 记录，不设密码。
  // 第一次使用时通过注册流程创建。
  // admin 用户的 role 通过 email 匹配在注册时自动设置。

  logger.info({ email: adminEmail, userId }, 'Admin user created (no password — register via UI to set)');
  return userId;
}

// ── 2. 导入 source-packs ──

interface SourcePackEntry {
  name: string;
  url?: string;
  type: string;
  tier: number;
  category?: string;
  tags?: string[];
  language?: string;
  fetchConfig?: Record<string, unknown>;
}

interface SourcePack {
  sources: SourcePackEntry[];
}

async function seedSources() {
  const sourcePackDir = join(process.cwd(), '../../source-packs');
  const files = readdirSync(sourcePackDir).filter(f => f.endsWith('.yaml'));

  let imported = 0;

  for (const file of files) {
    const content = readFileSync(join(sourcePackDir, file), 'utf-8');
    const pack: SourcePack = parseYaml(content);

    if (!pack.sources) {
      logger.warn({ file }, 'No sources found in pack');
      continue;
    }

    for (const source of pack.sources) {
      const id = nanoid();
      const now = new Date();

      db.insert(feedSources).values({
        id,
        name: source.name,
        url: source.url || '',  // Google News 类型可能没有 url
        type: source.type as any,
        tier: source.tier,
        category: source.category || null,
        tags: source.tags || [],
        language: source.language || null,
        enabled: true,
        fetchConfig: source.fetchConfig || null,
        isGlobal: true,
        createdAt: now,
      }).onConflictDoNothing().run();

      imported++;
    }

    logger.info({ file, count: pack.sources.length }, 'Imported source pack');
  }

  logger.info({ total: imported }, 'Total sources imported');
}

// ── Main ──

async function main() {
  logger.info('🌱 Starting seed...');

  await seedAdmin();
  await seedSources();

  logger.info('🌱 Seed complete!');
  process.exit(0);
}

main().catch((err) => {
  logger.error(err, 'Seed failed');
  process.exit(1);
});
```

3. 在 `packages/backend/package.json` 添加 script：
```json
{
  "scripts": {
    "db:seed": "tsx src/db/seed.ts"
  }
}
```

4. 在根 `package.json` 添加：
```json
{
  "scripts": {
    "db:seed": "npm run db:seed -w packages/backend"
  }
}
```

5. 执行 seed：
```bash
npm run db:seed
```

**验收**：
```bash
# 检查 admin 用户
sqlite3 packages/backend/data/arclight.db "SELECT id, email, role FROM user;"
# 预期：一行，admin@arclight.local, admin

# 检查 feed sources
sqlite3 packages/backend/data/arclight.db "SELECT COUNT(*) FROM feed_sources;"
# 预期：约 25-30 条（4 个 YAML 文件的总源数）

sqlite3 packages/backend/data/arclight.db "SELECT name, type, tier FROM feed_sources LIMIT 5;"
# 应能看到具体的源名
```

---

## C. 认证系统

### C1. better-auth 服务端配置

**依赖**：B1 完成（schema 已调整、migration 已执行）

**目标**：配置 better-auth 实例，与 Drizzle SQLite 集成。

**操作步骤**：

1. 创建 `packages/backend/src/auth/index.ts`：

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  secret: process.env.SESSION_SECRET,
  baseURL: process.env.BASE_URL || 'http://localhost:3000',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day — refresh if older than this
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
        input: false,  // 不允许客户端设置
      },
      timezone: {
        type: 'string',
        defaultValue: 'UTC',
        input: true,
      },
      locale: {
        type: 'string',
        defaultValue: 'zh-CN',
        input: true,
      },
    },
  },
  trustedOrigins: [
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3000',
  ],
});

// Export type for frontend client
export type Auth = typeof auth;
```

2. 创建 Hono handler `packages/backend/src/auth/handler.ts`：

```typescript
import { Hono } from 'hono';
import { auth } from './index.js';

const authApp = new Hono();

// better-auth 处理所有 /api/auth/* 路由
authApp.on(['GET', 'POST'], '/**', (c) => {
  return auth.handler(c.req.raw);
});

export { authApp };
```

**验收**：此步骤无独立验收，由 C2 统一验证。

---

### C2. 挂载 Auth 路由到 Hono

**依赖**：C1 完成

**目标**：将 better-auth 路由挂载到主 Hono app，实现注册/登录/登出/获取当前用户。

**操作步骤**：

1. 修改 `packages/backend/src/index.ts`：

```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './shared/logger.js';
import { authApp } from './auth/handler.js';

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,  // 关键：允许 cookie 跨域
}));
app.use('*', honoLogger());

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes — better-auth handles /api/auth/*
app.route('/api/auth', authApp);

// TODO: Mount other route modules
// app.route('/api/v1/sources', sourceRoutes);
// app.route('/api/v1/me', userRoutes);

export type AppType = typeof app;

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`🚀 ArcLight running on http://localhost:${info.port}`);
});
```

**验收**：
```bash
# 启动 backend
npm run dev:backend

# 测试注册
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@arclight.local","password":"testpass123","name":"Test User"}' \
  -v

# 预期：200 OK，返回 JSON 包含 user 对象和 session
# 响应头应包含 Set-Cookie

# 测试登录
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@arclight.local","password":"testpass123"}' \
  -c cookies.txt \
  -v

# 预期：200 OK，cookies.txt 中有 session cookie

# 测试获取当前用户
curl http://localhost:3000/api/auth/get-session \
  -b cookies.txt

# 预期：200 OK，返回当前 session + user 信息

# 测试登出
curl -X POST http://localhost:3000/api/auth/sign-out \
  -b cookies.txt

# 预期：200 OK
```

---

### C3. 认证中间件（受保护路由）

**依赖**：C2 完成

**目标**：创建 Hono 中间件，验证请求是否已认证，提取当前用户。

**操作步骤**：

1. 创建 `packages/backend/src/middleware/auth.ts`：

```typescript
import { createMiddleware } from 'hono/factory';
import { auth } from '../auth/index.js';
import type { Session, User } from 'better-auth/types';

// 扩展 Hono Context 的 Variables 类型
export type AuthVariables = {
  user: User & { role: string; timezone: string; locale: string };
  session: Session;
};

/**
 * 要求已登录。
 * 成功时将 user + session 注入 c.var。
 * 失败时返回 401。
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', session.user as AuthVariables['user']);
  c.set('session', session.session);
  await next();
});

/**
 * 要求 admin 角色。
 * 必须在 requireAuth 之后使用。
 */
export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden: admin required' }, 403);
  }
  await next();
});
```

**验收**：
```bash
# 访问一个受保护的端点（D1 任务会创建，这里仅验证中间件逻辑）
# 无 cookie 访问
curl http://localhost:3000/api/v1/sources -v
# 预期：401 Unauthorized

# 带 cookie 访问
curl http://localhost:3000/api/v1/sources -b cookies.txt
# 预期：200（在 D1 完成后验证）
```

---

## D. 基础 API

### D1. Feed Sources CRUD（admin only）

**依赖**：C3 完成

**目标**：实现 feed source 的增删改查 API，仅 admin 可用。

**操作步骤**：

1. 安装 nanoid（已在 backend dependencies 中）。

2. 创建 `packages/backend/src/routes/sources.ts`：

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/client.js';
import { feedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth, requireAdmin, type AuthVariables } from '../middleware/auth.js';

const sourceRoutes = new Hono<{ Variables: AuthVariables }>();

// 所有路由要求认证 + admin
sourceRoutes.use('*', requireAuth, requireAdmin);

// ── List all sources ──
sourceRoutes.get('/', async (c) => {
  const sources = await db.select().from(feedSources);
  return c.json({ data: sources });
});

// ── Get single source ──
sourceRoutes.get('/:id', async (c) => {
  const source = await db.select().from(feedSources).where(eq(feedSources.id, c.req.param('id'))).get();
  if (!source) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: source });
});

// ── Create source ──
const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().max(2000).default(''),
  type: z.enum(['rss', 'atom', 'google-news', 'x', 'v2ex', 'youtube', 'wechat', 'custom']),
  tier: z.number().int().min(1).max(4).default(3),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  language: z.string().optional(),
  enabled: z.boolean().default(true),
  fetchConfig: z.record(z.unknown()).optional(),
  isGlobal: z.boolean().default(false),
});

sourceRoutes.post('/', zValidator('json', createSourceSchema), async (c) => {
  const body = c.req.valid('json');
  const user = c.get('user');
  const id = nanoid();
  const now = new Date();

  await db.insert(feedSources).values({
    id,
    ...body,
    fetchConfig: body.fetchConfig || null,
    createdBy: user.id,
    createdAt: now,
  });

  const created = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  return c.json({ data: created }, 201);
});

// ── Update source ──
const updateSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().max(2000).optional(),
  tier: z.number().int().min(1).max(4).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  language: z.string().optional(),
  enabled: z.boolean().optional(),
  fetchConfig: z.record(z.unknown()).optional(),
  isGlobal: z.boolean().optional(),
});

sourceRoutes.patch('/:id', zValidator('json', updateSourceSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(feedSources).set(body).where(eq(feedSources.id, id));

  const updated = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  return c.json({ data: updated });
});

// ── Delete source ──
sourceRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await db.select().from(feedSources).where(eq(feedSources.id, id)).get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.delete(feedSources).where(eq(feedSources.id, id));
  return c.json({ message: 'Deleted' });
});

export { sourceRoutes };
```

3. 在 `packages/backend/src/index.ts` 中挂载：
```typescript
import { sourceRoutes } from './routes/sources.js';
// ...
app.route('/api/v1/sources', sourceRoutes);
```

**验收**：
```bash
# 先用 admin 登录（admin 用户需要先通过 /api/auth/sign-up/email 注册，如果 seed 没设密码）
# 注册 admin@arclight.local
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@arclight.local","password":"admin12345","name":"Admin"}' \
  -c admin-cookies.txt

# 如果 admin@arclight.local 已被 seed 创建（无密码），注册可能冲突。
# 备选方案：seed 时就不创建 user，让第一个注册 ADMIN_EMAIL 的用户自动成为 admin。
# 具体逻辑见下方 "admin 自动提权" 说明。

# List sources（需要 admin cookies）
curl http://localhost:3000/api/v1/sources -b admin-cookies.txt
# 预期：200，返回 seed 导入的 source 列表

# Create source
curl -X POST http://localhost:3000/api/v1/sources \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"name":"Test Source","url":"https://example.com/rss","type":"rss","tier":3}'
# 预期：201，返回创建的 source

# 普通用户访问应 403
curl http://localhost:3000/api/v1/sources -b user-cookies.txt
# 预期：403 Forbidden
```

> **Admin 自动提权说明**：在 better-auth 配置中增加 `onUserCreated` hook，当注册邮箱匹配 `ADMIN_EMAIL` 环境变量时，自动将 `role` 设为 `admin`：
>
> 在 `packages/backend/src/auth/index.ts` 中添加：
> ```typescript
> import { db } from '../db/client.js';
> import { users } from '../db/schema.js';
> import { eq } from 'drizzle-orm';
>
> export const auth = betterAuth({
>   // ... 其他配置 ...
>   databaseHooks: {
>     user: {
>       create: {
>         after: async (user) => {
>           const adminEmail = process.env.ADMIN_EMAIL;
>           if (adminEmail && user.email === adminEmail) {
>             await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
>           }
>         },
>       },
>     },
>   },
> });
> ```
>
> 这样 seed 脚本就不需要创建 admin 用户了。**修改 seed 脚本**：删除 `seedAdmin()` 函数，只保留 `seedSources()`。第一个用 `ADMIN_EMAIL` 注册的用户会自动成为 admin。

---

### D2. Source Pack 导入 API

**依赖**：D1 完成

**目标**：提供 API 端点，允许 admin 上传/导入 YAML source pack。

**操作步骤**：

1. 在 `packages/backend/src/routes/sources.ts` 中添加：

```typescript
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

// ── Import from source-packs directory ──
sourceRoutes.post('/import/packs', async (c) => {
  const sourcePackDir = join(process.cwd(), '../../source-packs');
  let files: string[];

  try {
    files = readdirSync(sourcePackDir).filter(f => f.endsWith('.yaml'));
  } catch {
    return c.json({ error: 'source-packs directory not found' }, 404);
  }

  const results: { file: string; imported: number; skipped: number }[] = [];

  for (const file of files) {
    const content = readFileSync(join(sourcePackDir, file), 'utf-8');
    const pack = parseYaml(content) as { sources?: SourcePackEntry[] };

    if (!pack.sources) {
      results.push({ file, imported: 0, skipped: 0 });
      continue;
    }

    let imported = 0;
    let skipped = 0;

    for (const source of pack.sources) {
      // 检查是否已存在（按 name + type 去重）
      const existing = await db.select()
        .from(feedSources)
        .where(eq(feedSources.name, source.name))
        .get();

      if (existing) {
        skipped++;
        continue;
      }

      await db.insert(feedSources).values({
        id: nanoid(),
        name: source.name,
        url: source.url || '',
        type: source.type as any,
        tier: source.tier,
        category: source.category || null,
        tags: source.tags || [],
        language: source.language || null,
        enabled: true,
        fetchConfig: source.fetchConfig || null,
        isGlobal: true,
        createdAt: new Date(),
      });

      imported++;
    }

    results.push({ file, imported, skipped });
  }

  return c.json({ data: results });
});

// ── Import from uploaded YAML body ──
const importYamlSchema = z.object({
  yaml: z.string().min(1),
});

sourceRoutes.post('/import/yaml', zValidator('json', importYamlSchema), async (c) => {
  const { yaml: yamlContent } = c.req.valid('json');
  const pack = parseYaml(yamlContent) as { sources?: SourcePackEntry[] };

  if (!pack.sources || pack.sources.length === 0) {
    return c.json({ error: 'No sources found in YAML' }, 400);
  }

  let imported = 0;

  for (const source of pack.sources) {
    await db.insert(feedSources).values({
      id: nanoid(),
      name: source.name,
      url: source.url || '',
      type: source.type as any,
      tier: source.tier,
      category: source.category || null,
      tags: source.tags || [],
      language: source.language || null,
      enabled: true,
      fetchConfig: source.fetchConfig || null,
      isGlobal: true,
      createdAt: new Date(),
    });
    imported++;
  }

  return c.json({ data: { imported } });
});
```

需要在文件顶部添加接口定义：
```typescript
interface SourcePackEntry {
  name: string;
  url?: string;
  type: string;
  tier: number;
  category?: string;
  tags?: string[];
  language?: string;
  fetchConfig?: Record<string, unknown>;
}
```

**验收**：
```bash
# 导入 source-packs（先清空已有的，或者跳过重复）
curl -X POST http://localhost:3000/api/v1/sources/import/packs \
  -b admin-cookies.txt
# 预期：200，返回每个文件的导入统计

# 验证数据
curl http://localhost:3000/api/v1/sources -b admin-cookies.txt | jq '.data | length'
# 预期：约 25-30
```

---

## E. 前端基础

### E1. shadcn/ui 初始化

**依赖**：A1 完成

**目标**：在 frontend package 中初始化 shadcn/ui，可以使用基础组件。

**操作步骤**：

1. 在 frontend 目录初始化 shadcn：
```bash
cd ~/projects/arclight/packages/frontend
npx shadcn@latest init
```

   交互式选择（如果被问到）：
   - Style: **New York**
   - Base color: **Neutral**
   - CSS variables: **Yes**

   这会自动：
   - 创建 `components.json`
   - 更新 `globals.css` 添加 CSS 变量
   - 创建 `src/lib/utils.ts`（包含 `cn()` 函数）
   - 安装 `tailwind-merge`, `clsx`, `class-variance-authority`, `lucide-react`

2. 安装常用组件（Milestone 1 需要的）：
```bash
npx shadcn@latest add button input label card form toast separator avatar dropdown-menu sheet
```

3. 验证 `globals.css` 是否被正确更新。如果 shadcn init 覆盖了 TailwindCSS v4 的 `@import "tailwindcss"` 导入，需要确保它在文件顶部。

**验收**：
```bash
# 组件文件存在
ls packages/frontend/src/components/ui/
# 应包含：button.tsx, input.tsx, label.tsx, card.tsx, form.tsx 等

# 构建无报错
cd ~/projects/arclight
npm run dev:frontend
# Vite 启动无错误，浏览器能加载
```

---

### E2. API Client 设置

**依赖**：A1 完成，C2 完成（需要 auth API 可用来测试）

**目标**：创建类型安全的 API client，供前端调用后端 API。

**操作步骤**：

1. 安装 better-auth 客户端（前端也需要）：
```bash
npm install better-auth -w packages/frontend
```

2. 创建 `packages/frontend/src/lib/auth-client.ts`：

```typescript
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
});

// 导出常用 hooks
export const {
  useSession,
  signIn,
  signUp,
  signOut,
} = authClient;
```

3. 创建通用 API fetch wrapper `packages/frontend/src/lib/api.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: unknown,
  ) {
    super(`API Error ${status}: ${statusText}`);
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    credentials: 'include',  // 发送 cookie
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, res.statusText, data);
  }

  return res.json();
}

// 便捷方法
export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) =>
    apiFetch<T>(path, { method: 'DELETE' }),
};
```

4. 创建 auth store `packages/frontend/src/stores/auth.ts`：

```typescript
import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  image?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setLoading: (isLoading) => set({ isLoading }),
}));
```

**验收**：TypeScript 编译通过，无 import 报错。

---

### E3. 登录/注册页面

**依赖**：E1 + E2 完成

**目标**：实现登录和注册页面，使用 shadcn/ui 组件和 better-auth client。

**操作步骤**：

1. 创建 `packages/frontend/src/pages/Login.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || 'Login failed');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">🔦 ArcLight</CardTitle>
          <CardDescription>登录你的账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-neutral-500">
            还没有账号？{' '}
            <Link to="/register" className="text-primary underline">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

2. 创建 `packages/frontend/src/pages/Register.tsx`：

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (result.error) {
        setError(result.error.message || 'Registration failed');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">🔦 ArcLight</CardTitle>
          <CardDescription>创建新账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">昵称</Label>
              <Input
                id="name"
                type="text"
                placeholder="你的昵称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-neutral-500">
            已有账号？{' '}
            <Link to="/login" className="text-primary underline">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**验收**：
```bash
# 启动 dev，浏览器访问 http://localhost:5173/login
# 应看到登录表单
# 访问 http://localhost:5173/register
# 应看到注册表单
# 填写表单提交，应能注册/登录成功并跳转到 /dashboard
```

---

### E4. 基础 Layout（Sidebar + Header）+ Dashboard 占位页

**依赖**：E1 + E2 + E3 完成

**目标**：创建 authenticated layout，包含顶部导航栏和侧边栏。

**操作步骤**：

1. 创建 `packages/frontend/src/components/layout/AppLayout.tsx`：

```tsx
import { Outlet, useNavigate, Link, useLocation } from 'react-router';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  { label: 'Digests', path: '/digests', icon: '📰' },
  { label: 'Story Arcs', path: '/arcs', icon: '🧵' },
  { label: 'Settings', path: '/settings', icon: '⚙️' },
];

function Sidebar({ className }: { className?: string }) {
  const location = useLocation();

  return (
    <nav className={className}>
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="text-xl">🔦</span>
        <span className="text-lg font-bold">ArcLight</span>
      </div>
      <ul className="space-y-1">
        {navItems.map((item) => (
          <li key={item.path}>
            <Link
              to={item.path}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                location.pathname.startsWith(item.path)
                  ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  const handleLogout = async () => {
    await authClient.signOut();
    navigate('/login');
  };

  // 未登录或加载中重定向到 login
  if (!isPending && !session) {
    navigate('/login');
    return null;
  }

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800 lg:block">
        <Sidebar />
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                ☰
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-4">
              <Sidebar />
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback>
                    {session?.user?.name?.[0]?.toUpperCase() || '?'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">{session?.user?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                ⚙️ 设置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                🚪 退出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Main content */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

2. 创建 `packages/frontend/src/pages/Dashboard.tsx`：

```tsx
export default function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Dashboard
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        欢迎使用 ArcLight — 你的智能信息助手
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">信源数量</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">今日文章</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">活跃 Story Arcs</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
      </div>
      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">最近摘要</h2>
        <p className="mt-4 text-neutral-500">暂无摘要，等待后续 milestone 实现...</p>
      </div>
    </div>
  );
}
```

3. 更新 `packages/frontend/src/App.tsx` — 整合路由：

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import AppLayout from '@/components/layout/AppLayout';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/digests" element={<Placeholder title="Digests" />} />
          <Route path="/arcs" element={<Placeholder title="Story Arcs" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
        </Route>

        {/* Redirect */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-neutral-500">Coming in Milestone 2+...</p>
    </div>
  );
}
```

**验收**：
```bash
# npm run dev
# 浏览器访问 http://localhost:5173/
# 未登录 → 被重定向到 /login
# 登录后 → 看到带 Sidebar + Header 的 Dashboard
# Sidebar 有 Dashboard / Digests / Story Arcs / Settings 链接
# 点击 Sidebar 链接可以切换页面（占位页）
# 右上角有用户头像，点击可看到菜单，退出后回到 /login
# 响应式：窄屏时 Sidebar 隐藏，出现汉堡菜单
```

---

### E5. 前端环境变量

**操作步骤**：

1. 创建 `packages/frontend/.env`：
```env
VITE_API_URL=http://localhost:3000
```

2. 创建 `packages/frontend/src/vite-env.d.ts`（如果不存在）：
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

**验收**：TypeScript 编译通过，`import.meta.env.VITE_API_URL` 有类型提示。

---

## F. Docker

### F1. 修复 Dockerfile 并验证构建

**依赖**：A-E 全部完成

**目标**：`docker build` 能成功构建镜像。

**操作步骤**：

1. 更新 `Dockerfile` — 修复一些潜在问题：

```dockerfile
# Multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for caching
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Production image ──
FROM node:22-alpine AS runner
WORKDIR /app

# better-sqlite3 需要 libstdc++
RUN apk add --no-cache libstdc++

# 只复制生产依赖
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN npm ci --omit=dev --workspace=packages/backend --workspace=packages/shared

# 复制构建产物
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/drizzle ./packages/backend/drizzle
COPY --from=builder /app/packages/frontend/dist ./public

# 复制 source-packs (seed 用)
COPY source-packs ./source-packs

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/data/arclight.db
EXPOSE 3000

# 启动时从 packages/backend 目录运行
WORKDIR /app/packages/backend
CMD ["node", "dist/index.js"]
```

2. 更新 `docker-compose.yml`：
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/data/arclight.db
      - SESSION_SECRET=${SESSION_SECRET}
      - ADMIN_EMAIL=${ADMIN_EMAIL}
      - LLM_PROVIDER=${LLM_PROVIDER:-none}
      - LLM_API_KEY=${LLM_API_KEY:-}
      - LLM_MODEL=${LLM_MODEL:-gpt-4o-mini}
      - TZ=${TZ:-Asia/Shanghai}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    volumes:
      - arclight-data:/data
    restart: unless-stopped

volumes:
  arclight-data:
```

3. 构建：
```bash
docker build -t arclight:dev .
```

**验收**：
```bash
docker build -t arclight:dev .
# 构建成功，无报错

docker images arclight
# REPOSITORY   TAG   IMAGE ID       CREATED        SIZE
# arclight     dev   ...            seconds ago    ~200MB
```

---

### F2. docker compose up 验证

**依赖**：F1 完成

**操作步骤**：

```bash
# 确保 .env 文件有 SESSION_SECRET 和 ADMIN_EMAIL
docker compose up -d
```

**验收**：
```bash
# 容器运行中
docker compose ps
# 应显示 app 状态为 running

# Health check
curl http://localhost:3000/api/health
# {"status":"ok","version":"0.1.0","timestamp":"..."}

# 清理
docker compose down
```

---

## G. 整体验收

### G1. 端到端验收流程

**依赖**：全部任务完成

以下是完整的端到端验收流程，按顺序执行：

#### 1️⃣ 环境验证
```bash
cd ~/projects/arclight

# 依赖完整
npm ls --depth=0 2>&1 | grep -v "^$"
# 无 missing 警告

# TypeScript 编译
npm run typecheck
# 退出码 0
```

#### 2️⃣ 数据库验证
```bash
# 数据库存在
ls packages/backend/data/arclight.db

# 表结构完整
sqlite3 packages/backend/data/arclight.db ".tables"
# 包含所有 10+ 张表

# Seed 数据
sqlite3 packages/backend/data/arclight.db "SELECT COUNT(*) FROM feed_sources;"
# > 0
```

#### 3️⃣ Dev Server 启动
```bash
npm run dev
# 等待 backend + frontend 启动完毕
```

#### 4️⃣ Backend API 验证
```bash
# Health check
curl -s http://localhost:3000/api/health | jq .
# {"status":"ok","version":"0.1.0","timestamp":"..."}

# 注册用户
curl -s -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@arclight.local","password":"admin12345","name":"Admin"}' \
  -c cookies.txt | jq .
# 200 OK，返回 user + session

# 获取 session
curl -s http://localhost:3000/api/auth/get-session \
  -b cookies.txt | jq .
# 返回当前用户信息

# Feed Sources (admin)
curl -s http://localhost:3000/api/v1/sources \
  -b cookies.txt | jq '.data | length'
# seed 后应 > 0

# 登出
curl -s -X POST http://localhost:3000/api/auth/sign-out \
  -b cookies.txt | jq .
# 200 OK

# 登出后访问受保护端点
curl -s http://localhost:3000/api/v1/sources \
  -b cookies.txt
# 401 Unauthorized
```

#### 5️⃣ 前端验证
```bash
# 浏览器访问以下地址，逐一验证：

# http://localhost:5173/
# → 自动重定向到 /login

# http://localhost:5173/login
# → 显示登录表单

# http://localhost:5173/register
# → 显示注册表单

# 注册一个新用户 → 提交 → 跳转到 /dashboard
# → 看到带 Sidebar 的 Dashboard 页面
# → 右上角显示用户名

# 点击 Sidebar 各链接
# → Digests / Story Arcs / Settings 显示占位页

# 退出 → 回到 /login
```

#### 6️⃣ Docker 验证
```bash
# 构建
docker build -t arclight:dev .
# 成功

# 运行
docker compose up -d

# 等待启动（约 3-5 秒）
sleep 5

# Health check
curl -s http://localhost:3000/api/health | jq .
# 200 OK

# 清理
docker compose down -v
```

---

## 附录：完整文件清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `packages/backend/src/auth/index.ts` | better-auth 配置 |
| `packages/backend/src/auth/handler.ts` | Hono auth 路由 handler |
| `packages/backend/src/middleware/auth.ts` | requireAuth + requireAdmin 中间件 |
| `packages/backend/src/routes/sources.ts` | Feed Sources CRUD + import |
| `packages/backend/src/db/migrate.ts` | Migration 执行脚本 |
| `packages/backend/src/db/seed.ts` | Seed 脚本 |
| `packages/frontend/src/lib/auth-client.ts` | better-auth React client |
| `packages/frontend/src/lib/api.ts` | 通用 API fetch wrapper |
| `packages/frontend/src/stores/auth.ts` | Zustand auth store |
| `packages/frontend/src/pages/Login.tsx` | 登录页 |
| `packages/frontend/src/pages/Register.tsx` | 注册页 |
| `packages/frontend/src/pages/Dashboard.tsx` | Dashboard 占位页 |
| `packages/frontend/src/components/layout/AppLayout.tsx` | 主 layout |
| `packages/frontend/.env` | 前端环境变量 |
| `.env` | 后端环境变量 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `packages/backend/src/db/schema.ts` | 适配 better-auth（表名、字段名、新增 account/verification 表） |
| `packages/backend/src/db/client.ts` | 默认路径改为 `arclight.db` |
| `packages/backend/drizzle.config.ts` | 默认路径改为 `arclight.db` |
| `packages/backend/src/index.ts` | 挂载 auth + sources 路由，CORS credentials |
| `packages/backend/package.json` | 新增 scripts + yaml 依赖 |
| `packages/frontend/src/App.tsx` | 完整路由配置 |
| `packages/frontend/src/styles/globals.css` | shadcn CSS 变量 |
| `packages/frontend/package.json` | 新增 better-auth 依赖 |
| `packages/shared/src/types/feed.ts` | FeedAdapter 接口扩展 |
| `package.json`（根） | 新增 db:seed, db:migrate:run scripts |
| `Dockerfile` | 修复 multi-stage build |
| `docker-compose.yml` | 更新环境变量 |

### 安装的依赖
| Package | Workspace | 说明 |
|---------|-----------|------|
| `@types/node` | root (devDep) | Node.js 类型 |
| `yaml` | backend | YAML 解析（seed 用） |
| `better-auth` | frontend | Auth client |
| shadcn 组件 | frontend | button, input, label, card, form, toast, separator, avatar, dropdown-menu, sheet |

---

## 执行建议

1. **严格按 A→B→C→D / E 并行 的顺序执行**
2. **每完成一个任务就运行验收命令**，失败了立即修
3. **Schema 修改是最大风险点**：better-auth 对表结构有严格要求，如果验证不过，运行 `npx @better-auth/cli generate` 查看它期望的 schema，再手动对齐
4. **如果 shadcn init 对 TailwindCSS v4 不兼容**，参考 https://ui.shadcn.com/docs/installation/vite 的最新文档
5. **所有密码相关操作交给 better-auth 处理**，不要手动 hash

---

*Generated for ArcLight Milestone 1 — 2026-03-06*
