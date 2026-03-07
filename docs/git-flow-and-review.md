# ArcLight — Git Flow & Code Review 规范

**作者**：Opus（系统架构师）
**日期**：2026-03-07
**状态**：Active
**适用范围**：所有 ArcLight 代码贡献（人类 & AI Agent）

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [Branch 策略](#2-branch-策略)
3. [开发流程](#3-开发流程)
4. [CI Pipeline](#4-ci-pipeline)
5. [Code Review Checklist](#5-code-review-checklist)
6. [Branch 保护规则](#6-branch-保护规则)
7. [AI Agent 协作约定](#7-ai-agent-协作约定)
8. [紧急修复流程](#8-紧急修复流程)

---

## 1. 背景与动机

### 出了什么问题

Milestone 2 完成后，Coder 直接 push 到 `main`，导致以下编译问题上线：

| 问题 | 影响 |
|------|------|
| `@tailwindcss/vite` 在 Vite 7.3.1 下不工作 | CSS utilities 完全不生效 |
| `tw-animate-css` exports 与 CSS `@import` 不兼容 | 构建失败 |
| `shadcn/tailwind.css` import 路径不存在 | 构建失败 |

**根因**：没有分支保护、没有 CI、没有 review，任何 push 都直接进 main。

### 设计原则

| 原则 | 含义 |
|------|------|
| **轻量优先** | AI agent 开发节奏快，流程不能比写代码还慢 |
| **自动化优先** | 能机器验证的绝不靠人眼 |
| **实用主义** | 不追求完美流程，但要防住"编译不过就进 main" |
| **信任但验证** | Agent 可以自主开发，但合并必须过 CI |

---

## 2. Branch 策略

### 分支模型：Trunk-Based + Short-Lived Feature Branches

```
main (protected)
 ├── feat/milestone-3-digest-delivery
 ├── feat/add-telegram-push
 ├── fix/tailwind-v4-compat
 └── hotfix/auth-crash
```

### 分支命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能开发 | `feat/milestone-3-digest-delivery` |
| `fix/` | Bug 修复 | `fix/tailwind-v4-compat` |
| `hotfix/` | 紧急生产修复 | `hotfix/auth-crash` |
| `refactor/` | 重构 | `refactor/feed-engine-cleanup` |
| `docs/` | 纯文档更新 | `docs/api-reference` |
| `ci/` | CI/CD 配置 | `ci/add-lint-step` |

### 规则

1. **`main` 是保护分支**，不允许直接 push
2. 所有代码变更必须通过 **Pull Request** 合并
3. Feature branch 从 `main` 创建，完成后 PR 回 `main`
4. Branch 生命周期 **不超过 3 天**（AI agent 的节奏应该更快）
5. 合并后**删除 feature branch**

### 例外

以下可以直接提交到 `main`：
- 纯文档更新（`docs/` 目录下的 `.md` 文件）
- CI 配置的初始设置
- `.gitignore`、`.env.example` 等项目配置

---

## 3. 开发流程

### 标准流程（适用于所有功能开发）

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────┐
│ 1. 创建分支  │────▶│ 2. 开发 + 提交│────▶│ 3. 开 PR  │────▶│ 4. CI 跑 │
└─────────────┘     └──────────────┘     └───────────┘     └──────────┘
                                                                  │
                                              ┌───────────────────┘
                                              ▼
                                         ┌──────────┐     ┌──────────┐
                                         │ 5. Review │────▶│ 6. Merge │
                                         └──────────┘     └──────────┘
```

### Step by Step

#### 1. 创建分支

```bash
git checkout main
git pull origin main
git checkout -b feat/your-feature-name
```

#### 2. 开发 + 本地验证

在 push 之前，**必须**在本地通过以下检查：

```bash
# TypeScript 编译检查
npm run typecheck

# 前后端构建
npm run build

# 前端开发服务器能正常启动（如果改了前端）
npm run dev:frontend
# 浏览器打开 http://localhost:5173 确认页面正常渲染
```

#### 3. 提交 + 推送

```bash
git add .
git commit -m "feat(scope): 简明描述"
git push origin feat/your-feature-name
```

**Commit Message 格式**：

```
<type>(<scope>): <description>

type: feat | fix | refactor | docs | ci | chore | test
scope: frontend | backend | shared | engine | auth | digest | ...
```

#### 4. 创建 Pull Request

- Title：与 commit message 一致
- Description：说明改了什么、为什么改、如何验证
- 关联 Issue（如有）

#### 5. CI 自动检查

PR 创建后，GitHub Actions 自动运行：
- TypeScript check（全量）
- Frontend build（`vite build`）
- Backend build（`tsc`）
- Lint（ESLint）

**CI 全绿才能合并。**

#### 6. Review + Merge

- Fadacai 或 Opus review PR
- 使用 **Squash Merge**，保持 main 历史干净
- 合并后自动删除 feature branch

---

## 4. CI Pipeline

### 触发条件

| 事件 | 触发 |
|------|------|
| Push to `main` | ✅ 全量检查 |
| Pull Request to `main` | ✅ 全量检查 |
| Push to feature branch | ✅ 全量检查 |

### Pipeline 步骤

```yaml
Jobs:
  typecheck:        # TypeScript 编译检查（tsc --build）
  build-frontend:   # Vite build（验证前端能产出产物）
  build-backend:    # tsc 编译后端
  lint:             # ESLint 检查
```

### 配置文件

完整配置见 `.github/workflows/ci.yml`。

### 关键设计决策

1. **Job 并行化**：typecheck / build-frontend / build-backend / lint 四个 job 并行跑，减少等待
2. **npm cache**：利用 `actions/setup-node` 的 cache 功能加速 `npm ci`
3. **Node 22**：与项目 `engines` 要求一致
4. **失败快速**：任何一个 job 失败就阻止合并

---

## 5. Code Review Checklist

### 通用检查（所有 PR）

- [ ] CI 全绿（typecheck + build + lint）
- [ ] Commit message 符合规范
- [ ] 没有引入不必要的依赖
- [ ] 没有提交敏感信息（`.env`、API key、密码）
- [ ] 改动范围合理（一个 PR 做一件事）

### 前端专项检查 ⚠️ 重点

> 这是 Milestone 2 翻车的重灾区，必须严格执行。

- [ ] `npm run build` 成功（**不是只跑 typecheck**）
- [ ] `npm run dev:frontend` 能正常启动
- [ ] 浏览器打开页面，**视觉渲染正常**（CSS 生效、布局正确）
- [ ] 新增 npm 包的**版本兼容性**已验证（特别是 Vite plugin 生态）
- [ ] CSS 方案变更时，验证 Tailwind utilities 正常工作
- [ ] 路由变更时，所有路由可正常访问
- [ ] 响应式布局在 mobile viewport 下正常

### 后端专项检查

- [ ] `npm run build` 成功（tsc 编译通过）
- [ ] API 端点可正常响应（`curl` 或 Hono 测试）
- [ ] 数据库 schema 变更有对应的 migration
- [ ] 错误处理覆盖（不抛裸 Error）

### 依赖变更专项检查

- [ ] `package.json` 变更时，`package-lock.json` 同步更新
- [ ] 新包的 license 兼容
- [ ] 新包的维护状态良好（>100 weekly downloads，最近 6 个月有更新）
- [ ] **版本范围合理**（避免 `latest`，优先用 `^` pinning）
- [ ] 检查新包与现有工具链的兼容性（特别是 Vite / Tailwind / React 版本矩阵）

---

## 6. Branch 保护规则

### GitHub 配置（Settings → Branches → Branch protection rules）

**Rule: `main`**

| 设置 | 值 |
|------|-----|
| Require a pull request before merging | ✅ |
| Required approvals | 1 |
| Require status checks to pass | ✅ |
| Required status checks | `typecheck`, `build-frontend`, `build-backend`, `lint` |
| Require branches to be up to date | ✅ |
| Do not allow bypassing | ✅ |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### 设置命令（使用 GitHub CLI）

```bash
# 在 GitHub repo Settings 中手动配置，或使用 API：
gh api repos/ripplek/arclight/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["typecheck","build-frontend","build-backend","lint"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null
```

---

## 7. AI Agent 协作约定

### 角色分工

| 角色 | 职责 | Git 权限 |
|------|------|----------|
| **Opus** | 架构设计、技术方案、Code Review | Review + Approve PR |
| **Coder** | 代码实现 | 创建 branch、push、开 PR |
| **Fadacai** | 协调、验收、最终 Approve | Review + Approve + Merge PR |

### Coder 的工作流程

```
1. 收到任务（来自 Opus 的技术方案 / Fadacai 的指令）
2. git checkout -b feat/task-name
3. 编码
4. 本地验证：
   a. npm run typecheck  ✅
   b. npm run build      ✅
   c. npm run dev         → 浏览器检查  ✅
5. git push origin feat/task-name
6. 创建 PR，描述改动内容
7. 等待 CI + Review
8. 根据 review 意见修改（如需要）
9. Review 通过后，由 Fadacai merge
```

### ⚠️ Coder 红线（绝对不能做的事）

1. **不得直接 push 到 `main`**
2. **不得 force push 到任何共享分支**
3. **不得跳过本地 build 验证就开 PR**
4. **不得引入未验证的依赖版本组合**

### Review 流程

```
Coder 开 PR
  → CI 自动跑（~2 min）
  → CI 全绿 → Fadacai / Opus review
  → Approve → Squash Merge
  → 自动删除 branch
```

---

## 8. 紧急修复流程

当 `main` 上发现严重 bug（比如服务无法启动）：

```
1. git checkout -b hotfix/description
2. 最小化修复
3. 本地验证
4. 推送 + 开 PR
5. CI 必须通过
6. 快速 review（可以 self-approve，但 CI 不能跳过）
7. Merge
```

**即使是 hotfix，CI 也不能跳过。** 这是底线。

---

## 附录 A：快速参考卡

### 日常命令

```bash
# 开始新功能
git checkout main && git pull && git checkout -b feat/xxx

# 本地全量验证
npm run typecheck && npm run build

# 推送并开 PR
git push origin feat/xxx
gh pr create --title "feat(scope): description" --body "..."

# 查看 CI 状态
gh pr checks

# Merge（review 通过后）
gh pr merge --squash --delete-branch
```

### Commit Type 速查

| Type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改行为） |
| `docs` | 文档 |
| `ci` | CI/CD |
| `chore` | 杂项（依赖更新等） |
| `test` | 测试 |

---

## 附录 B：为什么选择这个流程

### 对比方案

| 方案 | 优点 | 缺点 | 适合 |
|------|------|------|------|
| **Git Flow（经典）** | 严格、有 release branch | 太重、AI agent 不需要 release 分支 | 大团队 |
| **GitHub Flow** | 简单、一个 main + feature branch | 可能不够严格 | 小团队 |
| **Trunk-Based + CI** ✅ | 最简单、快速反馈、自动化兜底 | 需要强 CI | AI agent 协作 |

我们选择 **Trunk-Based + Short-Lived Feature Branches + 强 CI 保护**，因为：

1. AI agent 可以很快写完一个 feature，branch 不需要活太久
2. CI 是最可靠的 reviewer —— 它不会忘记跑 build
3. 流程越简单，AI agent 越容易遵守

---

*文档维护者：Opus | 最后更新：2026-03-07*
