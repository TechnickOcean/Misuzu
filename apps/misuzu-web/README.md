# misuzu-web

> A modern Vue.js web application powered by Hono and Vite.

[English](#english) | [中文](#chinese)

---

## English

### Overview

**misuzu-web** is a full-stack web application built with Vue 3, Vite, and Hono. It provides a modern interface for interacting with the Misuzu ecosystem.

### Features

- ⚡ **Fast Development** - Powered by Vite with instant HMR
- 🔄 **Full-Stack** - Vue 3 frontend with Hono backend
- 🎨 **Beautiful UI** - Built with Tailwind CSS and shadcn-vue
- 🧪 **Type-Safe** - Full TypeScript support front and back
- 🌙 **Dark Mode** - Built-in theme switching
- 🚀 **Production Ready** - Optimized build and deployment

### Technology Stack

- **Frontend**: Vue 3, Vue Router, Pinia, Tailwind CSS, shadcn-vue
- **Backend**: Hono, Node.js
- **Build**: Vite + Rolldown
- **Styling**: Tailwind CSS with Tailwind Merge
- **UI Components**: shadcn-vue
- **State Management**: Pinia
- **HTTP**: Axios for REST, WebSocket for real-time

### Quick Start

#### Setup

```bash
cd apps/misuzu-web
pnpm install
```

#### Development

```bash
# Run frontend dev server
pnpm run dev:client

# Run backend dev server (in another terminal)
pnpm run dev:server

# Or run both together
pnpm run dev:full
```

#### Build

```bash
# Build frontend
pnpm run build:client

# Type-check backend
pnpm run build:server
```

### Project Structure

```
src/
├── shared/
│   └── protocol.ts                 # Shared types between client and server
│
├── server/
│   ├── main.ts                     # Server entry point
│   ├── app.ts                      # Hono app setup
│   ├── routes/
│   │   └── api.ts                  # REST API routes
│   ├── services/
│   │   ├── workspace-manager.ts    # Core business logic
│   │   ├── workspace-registry-store.ts
│   │   └── event-bus.ts
│   └── di/
│       ├── container.ts            # Dependency injection
│       └── tokens.ts               # DI tokens
│
├── client/
│   ├── main.ts                     # Client entry point
│   ├── App.vue                     # Root component
│   ├── router.ts                   # Vue Router config
│   ├── styles.css                  # Global styles
│   ├── components/
│   │   ├── ui/                     # shadcn-vue components
│   │   ├── layout/                 # Layout components
│   │   └── workspace/              # Domain components
│   ├── views/
│   │   ├── HomeView.vue
│   │   ├── CreateWorkspaceView.vue
│   │   ├── SolverWorkspaceView.vue
│   │   └── runtime/                # Runtime workspace views
│   ├── stores/
│   │   ├── workspace-registry.ts
│   │   ├── runtime-workspace.ts
│   │   └── solver-workspace.ts
│   ├── composables/
│   │   ├── use-runtime-workspace.ts
│   │   ├── use-solver-workspace.ts
│   │   └── use-theme-mode.ts
│   ├── services/
│   │   ├── workspace-api.ts        # REST client
│   │   └── realtime-client.ts      # WebSocket client
│   ├── lib/
│   │   └── utils.ts                # UI utilities
│   └── di/
│       └── app-services.ts         # Client DI setup

```

### Key Features

#### REST API

Available under `/api`:

- `GET /api/workspaces` - List all workspaces
- `POST /api/workspaces/runtime` - Create runtime workspace
- `POST /api/workspaces/solver` - Create solver workspace
- `GET /api/plugins` - List available plugins
- `GET /api/plugins/:id/readme` - Get plugin documentation

#### WebSocket Events

Connect to `/ws?topic=<topic>` for real-time updates:

- `registry` - Workspace registry updates
- `runtime:<id>` - Runtime workspace events
- `solver:<id>` - Solver workspace events

### Development

#### Commands

```bash
# Format and lint
pnpm run check

# Run tests
pnpm run test

# Build for production
pnpm run build

# Start development server
pnpm run dev
```

#### Code Style

- No semicolons
- Strict TypeScript
- ES modules only
- 2-space indentation
- Single quotes

See [AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed guidelines.

#### State Management (Pinia)

- `workspace-registry` - Global workspace list
- `runtime-workspace` - Runtime workspace state
- `solver-workspace` - Solver workspace state

#### Composables

- `useRuntimeWorkspace(id)` - Runtime workspace composable
- `useSolverWorkspace(id)` - Solver workspace composable
- `useThemeMode()` - Theme management

### UI Components

Uses `shadcn-vue` components from the registry:

- Button, Card, Input, Textarea
- Badge, Select, Tabs, ScrollArea
- Separator, Switch, and more

To add new components:

```bash
npx shadcn-vue@latest add <component-name>
```

### Theme

Supports dark and light mode with Tailwind CSS:

- Toggle via `useThemeMode()` composable
- Persisted in localStorage
- System preference detection available

### API Integration

#### Client Service

```typescript
import { useWorkspaceApi } from "@/services/workspace-api"

const api = useWorkspaceApi()
const workspaces = await api.getWorkspaces()
```

#### WebSocket Client

```typescript
import { useRealtimeClient } from "@/services/realtime-client"

const realtime = useRealtimeClient()
realtime.subscribe("runtime:123", (message) => {
  console.log(message)
})
```

### Performance Considerations

- Only active agent states are kept in memory
- Inactive agents show summary-only data
- WebSocket events trigger debounced state refreshes
- Lazy loading of workspace details

### Testing

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test -- --watch

# Generate coverage report
pnpm run test -- --coverage
```

### Building for Production

```bash
# Build frontend and backend
pnpm run build

# Verify the build
ls dist/
```

### Deployment

The app can be deployed to any Node.js hosting platform:

1. Build: `pnpm run build`
2. Install production dependencies
3. Start server: `node dist/server.mjs` or `node dist/index.js`

### Troubleshooting

**Q: Dev server not starting**

- Run `pnpm install` to ensure all dependencies are installed
- Check that ports 5173 (frontend) and 3000 (backend) are available

**Q: Changes not reflected**

- Restart the dev server
- Clear browser cache and refresh
- Check browser console for errors

**Q: Build fails**

- Run `pnpm run check` to find issues
- Run `pnpm run build:server` to check backend types
- Check that all imports include `.ts` extension

### Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on:

- Code style
- Testing requirements
- Pull request process
- Commit message format

### License

MIT - See [LICENSE](../../LICENSE)

### Support

- **Issues**: [GitHub Issues](https://github.com/author/misuzu/issues)
- **Discussions**: [GitHub Discussions](https://github.com/author/misuzu/discussions)

---

## Chinese

### 概述

**misuzu-web** 是使用 Vue 3、Vite 和 Hono 构建的全栈 web 应用程序。它为与 Misuzu 生态系统交互提供了现代接口。

### 特性

- ⚡ **快速开发** - 由 Vite 提供支持，具有即时 HMR
- 🔄 **全栈** - Vue 3 前端和 Hono 后端
- 🎨 **精美 UI** - 使用 Tailwind CSS 和 shadcn-vue 构建
- 🧪 **类型安全** - 前后端完整的 TypeScript 支持
- 🌙 **深色模式** - 内置主题切换
- 🚀 **生产就绪** - 优化的构建和部署

### 技术栈

- **前端**: Vue 3、Vue Router、Pinia、Tailwind CSS、shadcn-vue
- **后端**: Hono、Node.js
- **构建**: Vite + Rolldown
- **样式**: Tailwind CSS 和 Tailwind Merge
- **UI 组件**: shadcn-vue
- **状态管理**: Pinia
- **HTTP**: REST 用 Axios，实时用 WebSocket

### 快速开始

#### 设置

```bash
cd apps/misuzu-web
pnpm install
```

#### 开发

```bash
# 运行前端开发服务器
pnpm run dev:client

# 运行后端开发服务器（在另一个终端）
pnpm run dev:server

# 或同时运行两者
pnpm run dev:full
```

#### 构建

```bash
# 构建前端
pnpm run build:client

# 类型检查后端
pnpm run build:server
```

### 项目结构

```
src/
├── shared/
│   └── protocol.ts                 # 客户端和服务器之间的共享类型
│
├── server/
│   ├── main.ts                     # 服务器入口点
│   ├── app.ts                      # Hono 应用设置
│   ├── routes/
│   │   └── api.ts                  # REST API 路由
│   ├── services/
│   │   ├── workspace-manager.ts    # 核心业务逻辑
│   │   ├── workspace-registry-store.ts
│   │   └── event-bus.ts
│   └── di/
│       ├── container.ts            # 依赖注入
│       └── tokens.ts               # DI 令牌
│
├── client/
│   ├── main.ts                     # 客户端入口点
│   ├── App.vue                     # 根组件
│   ├── router.ts                   # Vue Router 配置
│   ├── styles.css                  # 全局样式
│   ├── components/
│   │   ├── ui/                     # shadcn-vue 组件
│   │   ├── layout/                 # 布局组件
│   │   └── workspace/              # 领域组件
│   ├── views/
│   │   ├── HomeView.vue
│   │   ├── CreateWorkspaceView.vue
│   │   ├── SolverWorkspaceView.vue
│   │   └── runtime/                # 运行时工作区视图
│   ├── stores/
│   │   ├── workspace-registry.ts
│   │   ├── runtime-workspace.ts
│   │   └── solver-workspace.ts
│   ├── composables/
│   │   ├── use-runtime-workspace.ts
│   │   ├── use-solver-workspace.ts
│   │   └── use-theme-mode.ts
│   ├── services/
│   │   ├── workspace-api.ts        # REST 客户端
│   │   └── realtime-client.ts      # WebSocket 客户端
│   ├── lib/
│   │   └── utils.ts                # UI 工具
│   └── di/
│       └── app-services.ts         # 客户端 DI 设置
```

### 主要功能

#### REST API

可在 `/api` 下获得：

- `GET /api/workspaces` - 列出所有工作区
- `POST /api/workspaces/runtime` - 创建运行时工作区
- `POST /api/workspaces/solver` - 创建 solver 工作区
- `GET /api/plugins` - 列出可用的插件
- `GET /api/plugins/:id/readme` - 获取插件文档

#### WebSocket 事件

连接到 `/ws?topic=<topic>` 以获得实时更新：

- `registry` - 工作区注册表更新
- `runtime:<id>` - 运行时工作区事件
- `solver:<id>` - Solver 工作区事件

### 开发

#### 命令

```bash
# 格式化和 lint
pnpm run check

# 运行测试
pnpm run test

# 为生产构建
pnpm run build

# 启动开发服务器
pnpm run dev
```

#### 代码风格

- 无分号
- 严格的 TypeScript
- 仅 ES 模块
- 2 个空格缩进
- 单引号

有关详细指南，请参见 [AGENTS.md](../../AGENTS.md) 和 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

#### 状态管理 (Pinia)

- `workspace-registry` - 全局工作区列表
- `runtime-workspace` - 运行时工作区状态
- `solver-workspace` - Solver 工作区状态

#### Composables

- `useRuntimeWorkspace(id)` - 运行时工作区 composable
- `useSolverWorkspace(id)` - Solver 工作区 composable
- `useThemeMode()` - 主题管理

### UI 组件

使用来自注册表的 `shadcn-vue` 组件：

- Button、Card、Input、Textarea
- Badge、Select、Tabs、ScrollArea
- Separator、Switch 等

添加新组件：

```bash
npx shadcn-vue@latest add <component-name>
```

### 主题

使用 Tailwind CSS 支持深色和浅色模式：

- 通过 `useThemeMode()` composable 切换
- 在 localStorage 中持久化
- 可用系统偏好检测

### API 集成

#### 客户端服务

```typescript
import { useWorkspaceApi } from "@/services/workspace-api"

const api = useWorkspaceApi()
const workspaces = await api.getWorkspaces()
```

#### WebSocket 客户端

```typescript
import { useRealtimeClient } from "@/services/realtime-client"

const realtime = useRealtimeClient()
realtime.subscribe("runtime:123", (message) => {
  console.log(message)
})
```

### 性能考虑

- 只有活跃 agent 的状态保存在内存中
- 非活跃 agent 只显示摘要数据
- WebSocket 事件触发防抖状态刷新
- 延迟加载工作区详细信息

### 测试

```bash
# 运行所有测试
pnpm run test

# 在监听模式下运行测试
pnpm run test -- --watch

# 生成覆盖率报告
pnpm run test -- --coverage
```

### 为生产构建

```bash
# 构建前端和后端
pnpm run build

# 验证构建
ls dist/
```

### 部署

该应用可以部署到任何 Node.js 托管平台：

1. 构建：`pnpm run build`
2. 安装生产依赖
3. 启动服务器：`node dist/server.mjs` 或 `node dist/index.js`

### 故障排除

**Q：开发服务器未启动**

- 运行 `pnpm install` 确保所有依赖都已安装
- 检查端口 5173（前端）和 3000（后端）是否可用

**Q：更改未反映**

- 重启开发服务器
- 清除浏览器缓存并刷新
- 检查浏览器控制台是否有错误

**Q：构建失败**

- 运行 `pnpm run check` 查找问题
- 运行 `pnpm run build:server` 检查后端类型
- 检查所有导入是否包含 `.ts` 扩展名

### 贡献

有关以下内容的指南，请参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)：

- 代码风格
- 测试要求
- 拉取请求流程
- 提交消息格式

### 许可证

MIT - 请参见 [LICENSE](../../LICENSE)

### 支持

- **Issue 报告**: [GitHub Issues](https://github.com/author/misuzu/issues)
- **讨论**: [GitHub Discussions](https://github.com/author/misuzu/discussions)
