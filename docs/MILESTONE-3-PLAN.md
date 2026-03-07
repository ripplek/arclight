# Milestone 3 — 推送 + 源多样性 + Story Arc

> **目标**：让 ArcLight 成为每天主动给你推送精选新闻的智能助手，并具备故事线追踪的差异化能力。
>
> **分两个 Phase**：
> - Phase 1：推送 + 源多样性（让产品可用，自己每天用起来）
> - Phase 2：Story Arc + Buzz Signal（核心差异化）

---

## Phase 1 — 推送 + 源多样性（~15h）

### 目标
1. Digest 生成后自动推送到 Telegram
2. 可选：Email 推送
3. 源多样性优化（限制单源占比，防止 Bloomberg 霸屏）
4. 前端体验基础打磨

### 任务拆分

#### P1-1. 推送架构设计（Opus）
- 设计推送通道抽象层（PushChannel interface）
- 支持多通道：Telegram Bot / Email / Webhook
- 推送状态管理（pending → sent / failed）
- 推送配置存储在 userPreferences.pushChannels 中
- 考虑重试、限流、quiet hours

#### P1-2. Telegram Bot 推送（Coder）
**依赖**：P1-1
- 创建 Telegram Bot（BotFather）
- 用户绑定流程：前端输入 Telegram chat_id 或通过 Bot /start 命令自动绑定
- Digest 生成后调用 Telegram Bot API 发送
- Markdown 格式适配 Telegram（MarkdownV2 转义）
- 支持 Flash（纯文本）/ Daily（带链接）/ Deep（长消息分段）

#### P1-3. Email 推送（Coder）
**依赖**：P1-1
- 集成 nodemailer 或 Resend
- HTML 邮件模板（基于 renderer 的 HTML 输出）
- 用户配置邮箱地址
- 发送频率限制

#### P1-4. 推送调度集成（Coder）
**依赖**：P1-2, P1-3
- 修改 generate-digest job：生成后自动触发推送
- pushStatus 状态更新（pending → sending → sent / failed）
- 推送失败重试（最多 3 次，指数退避）
- quiet hours 检查（深夜不推送）

#### P1-5. 源多样性优化（Coder）
**独立任务，可与 P1-2 并行**
- Ranking 阶段添加"源多样性惩罚"：同一 source 的第 N 条新闻，分数乘以衰减因子（如 0.7^N）
- 配置项：maxPerSource（单源最多占比，默认 30%）
- 可选：源类别多样性（不要全是科技新闻）

#### P1-6. 前端推送配置页（Coder）
**依赖**：P1-1
- Settings 新增"推送渠道"配置页
- Telegram 绑定 UI（显示绑定状态、解绑按钮）
- Email 配置 UI
- 测试推送按钮（发送最近一期 Digest 到已配置渠道）

#### P1-7. Digest 质量微调（Coder）
- Flash 格式优化：去掉 tier badge，纯中文标题列表更清爽
- Telegram 消息格式测试和调整
- 处理超长消息（Telegram 4096 字符限制）分段发送

---

## Phase 2 — Story Arc + Buzz Signal（~25h）

### 目标
1. Story Arc：自动将零散新闻聚合成故事线，追踪事件发展
2. Buzz Signal：跨源热度检测，"大家在聊什么"
3. Serendipity：每期推一条"意外发现"

### 任务拆分

#### P2-1. Story Arc 技术方案（Opus）
- Entity + 时间线聚合算法设计
- 数据模型：story_arcs 表（id, title, entity, items[], status, startedAt, updatedAt）
- LLM 辅助：判断新闻是否属于已有 Arc，或创建新 Arc
- Arc 生命周期：active → stale → archived
- 前端展示方案

#### P2-2. Buzz Signal 技术方案（Opus）
- 跨源热度计算：同一事件在 N 个不同源出现 → buzz score
- 基于 entity + 时间窗口的聚合
- Buzz 阈值和衰减
- Alert 触发条件（突发事件检测）

#### P2-3. Story Arc 后端实现（Coder）
**依赖**：P2-1
- DB migration（story_arcs 表）
- Arc 聚合引擎
- Arc 更新逻辑（新 item 匹配已有 Arc）
- Arc 摘要生成（LLM）
- API 端点

#### P2-4. Buzz Signal 后端实现（Coder）
**依赖**：P2-2
- Buzz 计算模块
- Buzz Digest 类型（tier='buzz'）
- Alert 检测和推送

#### P2-5. Serendipity 模块（Coder）
- 策略：从非 topic 匹配的高 buzz 新闻中随机选 1 条
- 注入到 Daily digest 末尾
- "意外发现"标记

#### P2-6. Story Arc 前端（Coder）
**依赖**：P2-3
- Arc 列表页（活跃的故事线）
- Arc 详情页（时间线展示，关联新闻）
- Dashboard 集成（"正在追踪的故事"）

#### P2-7. Digest 增强渲染（Coder）
- Daily Digest 加入 Buzz 热点板块
- Story Arc 引用（"此新闻属于故事线: xxx"）
- Serendipity 板块

---

## 执行顺序

```
Phase 1（可并行）:
  P1-1（Opus 设计）→ P1-2 + P1-3（并行）→ P1-4
  P1-5（独立，与上面并行）
  P1-6（依赖 P1-1）
  P1-7（独立）

Phase 2:
  P2-1 + P2-2（Opus 并行设计）
  → P2-3 + P2-4 + P2-5（Coder 实现）
  → P2-6 + P2-7（前端）
```

## 优先级排序

1. 🔴 P1-1 推送架构设计（Opus）— 阻塞后续所有推送任务
2. 🔴 P1-5 源多样性 — 独立，立即可做
3. 🔴 P1-2 Telegram 推送 — 核心交付
4. 🟠 P1-4 推送调度集成
5. 🟠 P1-7 Digest 质量微调
6. 🟡 P1-3 Email 推送（可延后）
7. 🟡 P1-6 前端推送配置
8. 🔵 Phase 2 全部

---

*Generated for ArcLight Milestone 3 — 2026-03-07*
