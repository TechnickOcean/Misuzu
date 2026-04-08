# misuzu-web

> Local control plane for Misuzu workspaces: create runtime/solver workspaces, drive queue orchestration, and inspect agent conversations in real time.

[English](#english) | [中文](#中文)

---

## English

### Overview

`misuzu-web` is a full-stack app:

- **Frontend**: Vue 3 + Vue Router + Pinia + shadcn-vue UI
- **Backend**: Hono + WebSocket pub/sub
- **Domain service**: `WorkspaceManager` (bridges HTTP/WS and `misuzu-core`)

It manages two workspace kinds:

- `solver`: standalone single-agent workspace
- `ctf-runtime`: orchestrated multi-challenge runtime workspace

### Quick Start

```bash
cd apps/misuzu-web
vp install
vp run dev:full
```

Manual split mode:

```bash
cd apps/misuzu-web
vp run dev:client
vp run dev:server
```

Build and checks:

```bash
cd apps/misuzu-web
vp run build:client
vp run build:server
vp check
```

Backend port defaults to `8787` (`MISUZU_WEB_PORT`).

### Product Flow

1. Open workspace dashboard (`/`).
2. Create runtime workspace via 4-step wizard:
   - basics (name/root dir)
   - `providers.json` + model pool
   - plugin setup (currently `gzctf`)
   - confirm and create
3. Initialize runtime plugin and sync challenges/notices.
4. Start/pause dispatch, enqueue/dequeue tasks, reset/block/unblock/mark-solved per challenge.
5. Open runtime agent pages for conversation traces and upload/view `WriteUp.md`.
6. Export merged runtime writeups.

### Key API Endpoints

All under `/api`.

- `GET /workspaces`
- `POST /workspaces/runtime`
- `POST /workspaces/runtime/:workspaceId/runtime/init`
- `POST /workspaces/runtime/:workspaceId/dispatch/start`
- `POST /workspaces/runtime/:workspaceId/dispatch/pause`
- `POST /workspaces/runtime/:workspaceId/sync/challenges`
- `POST /workspaces/runtime/:workspaceId/sync/notices`
- `POST /workspaces/runtime/:workspaceId/solver/mark-solved`
- `GET /workspaces/runtime/:workspaceId/writeups/export`
- `POST /workspaces/solver`
- `POST /workspaces/solver/:workspaceId/prompt`
- `GET /plugins`, `GET /plugins/:pluginId/readme`
- `GET /providers/catalog`

### WebSocket Topics

Connect to `/ws?topic=...`.

- `registry`
- `runtime:<workspaceId>`
- `solver:<workspaceId>`

Message types include:

- `registry.updated`
- `runtime.snapshot`
- `solver.snapshot`
- `agent.event`

### Directory Map

```text
src/
├─ client/
│  ├─ app/router.ts
│  ├─ features/workspace-registry/
│  ├─ features/workspace-runtime/
│  ├─ features/workspace-solver/
│  ├─ shared/services/workspace-api.ts
│  └─ widgets/chat/AgentChatPanel.vue
├─ server/
│  ├─ app.ts
│  ├─ main.ts
│  ├─ routes/api.ts
│  └─ services/workspace-manager.ts
└─ shared/protocol.ts
```

### Persistence

Web app data is stored under:

- `apps/misuzu-web/.misuzu-web/workspace-registry.json`
- workspace roots selected during creation (runtime/solver states live there)

### License

GPL-3.0. See `../../LICENSE`.

---

## 中文

### 概述

`misuzu-web` 是 Misuzu 的本地控制台，负责：

- 创建/管理 `solver` 与 `ctf-runtime` 工作区
- 控制 runtime 队列调度与题目状态
- 实时查看 agent 状态与消息流
- 导出 writeup

技术栈：

- 前端：Vue 3 + Vue Router + Pinia + shadcn-vue
- 后端：Hono + WebSocket
- 业务核心：`WorkspaceManager`（连接前端与 `misuzu-core`）

### 快速开始

```bash
cd apps/misuzu-web
vp install
vp run dev:full
```

前后端分开运行：

```bash
cd apps/misuzu-web
vp run dev:client
vp run dev:server
```

构建与检查：

```bash
cd apps/misuzu-web
vp run build:client
vp run build:server
vp check
```

后端默认端口 `8787`，可通过 `MISUZU_WEB_PORT` 覆盖。

### 主要使用流程

1. 在首页工作区面板查看/进入工作区。
2. 通过 4 步向导创建 runtime 工作区（基础信息 -> providers/model pool -> 插件配置 -> 确认）。
3. 初始化插件并同步挑战与公告。
4. 启停调度，按题目执行 enqueue/dequeue/reset/block/unblock/mark-solved。
5. 打开 agent 页面查看会话并上传/读取 `WriteUp.md`。
6. 导出合并后的 writeup 文档。

### 关键接口

全部在 `/api` 下，例如：

- `GET /workspaces`
- `POST /workspaces/runtime`
- `POST /workspaces/runtime/:workspaceId/runtime/init`
- `POST /workspaces/runtime/:workspaceId/dispatch/start`
- `POST /workspaces/runtime/:workspaceId/sync/challenges`
- `POST /workspaces/runtime/:workspaceId/solver/mark-solved`
- `GET /workspaces/runtime/:workspaceId/writeups/export`
- `POST /workspaces/solver`
- `POST /workspaces/solver/:workspaceId/prompt`

### WebSocket 主题

通过 `/ws?topic=...` 订阅：

- `registry`
- `runtime:<workspaceId>`
- `solver:<workspaceId>`

主要消息类型：`registry.updated`、`runtime.snapshot`、`solver.snapshot`、`agent.event`。

### 目录结构

```text
src/
├─ client/
│  ├─ app/router.ts
│  ├─ features/workspace-registry/
│  ├─ features/workspace-runtime/
│  ├─ features/workspace-solver/
│  └─ shared/services/workspace-api.ts
├─ server/
│  ├─ routes/api.ts
│  └─ services/workspace-manager.ts
└─ shared/protocol.ts
```

### 持久化

Web 控制台数据主要落盘到：

- `apps/misuzu-web/.misuzu-web/workspace-registry.json`
- 创建工作区时指定的 root 目录（运行时与 solver 状态都在该目录下）

### 许可证

GPL-3.0，见 `../../LICENSE`。
