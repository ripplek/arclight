# ArcLight

**智能信息助手** — 理解人类新闻消费习惯的多源聚合与个性化推送服务。

> Arc = 故事线，Light = 照亮。照亮信息的脉络。

## 理念

不做又一个 RSS 聚合器。做一个在对的时间、以对的深度、给你对的信息的智能助手。

### 核心 Features

- **📊 信息分层** — Flash(60秒速览) / Daily(今日精选) / Deep(深度推荐)，匹配不同消费场景
- **📌 Story Arc** — 自动将零散新闻聚合成故事线，追踪事件发展脉络
- **🏷️ Source Tier** — 四级信源分级（一手源→社区），影响排序权重
- **🔥 Buzz Signal** — 跨源热度检测，知道"大家在聊什么"
- **💡 Serendipity** — 每期推一条"意外发现"，防止信息茧房
- **🧠 Context Injection** — LLM 生成一句话背景，降低理解门槛
- **📈 Consumption Memory** — 越用越懂你的个性化推荐

## Quick Start

### Docker (推荐)

```bash
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY 和 SESSION_SECRET
docker compose up -d
```

访问 `http://localhost:3000`，首次启动会进入 Setup Wizard。

### 本地开发

```bash
npm install
npm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Hono + TypeScript |
| Frontend | React + Vite + TailwindCSS + shadcn/ui |
| Database | SQLite (Drizzle ORM) |
| Auth | better-auth |
| LLM | Vercel AI SDK (OpenAI / Anthropic / Ollama) |
| Deploy | Docker Compose |

## Project Structure

```
packages/
├── shared/       # Shared TypeScript types
├── backend/      # Hono API server + feed engine
└── frontend/     # React SPA
source-packs/     # Pre-defined feed source configs
docs/             # PRD + Architecture
```

## License

MIT
