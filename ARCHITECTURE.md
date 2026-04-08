# Architecture Guide

[English](#english) | [中文](#chinese)

---

## English

This document describes the high-level architecture of Misuzu and explains how its components interact.

### Table of Contents

1. [Overview](#overview)
2. [Monorepo Structure](#monorepo-structure)
3. [Package Interactions](#package-interactions)
4. [Technology Stack](#technology-stack)
5. [Design Principles](#design-principles)
6. [Data Flow](#data-flow)
7. [Extension Points](#extension-points)

### Overview

Misuzu is organized as a monorepo with clear separation between:

- **Libraries** (`packages/`) - Reusable, publishable code
- **Applications** (`apps/`) - End-user facing applications
- **Tools** (`tools/`) - Internal development utilities
- **Plugins** (`plugins/`) - Extensible functionality

### Monorepo Structure

```
misuzu/
├── packages/
│   └── misuzu-core/
│       ├── src/
│       │   ├── index.ts           # Main entry point
│       │   ├── [features]/        # Feature modules
│       │   └── utils/             # Shared utilities
│       ├── dist/                  # Built output
│       └── package.json
│
├── apps/
│   └── misuzu-web/
│       ├── src/
│       │   ├── client/            # Vue frontend
│       │   ├── server/            # Hono backend
│       │   └── shared/            # Shared types
│       └── package.json
│
├── tools/                         # Internal tools
├── plugins/                       # Plugin system
├── examples/                      # Example code
│
└── [Configuration files]
    ├── package.json               # Root workspace
    ├── pnpm-workspace.yaml        # Workspace config
    ├── vite.config.ts             # Build config
    └── tsconfig.json              # TypeScript config
```

### Package Interactions

#### Dependency Graph

```
misuzu-web
  ├── depends on: misuzu-core
  ├── depends on: Vue 3
  ├── depends on: Hono
  └── depends on: Tailwind CSS

misuzu-core
  ├── depends on: TypeScript
  └── minimal external dependencies
```

#### Publishing Strategy

- **misuzu-core** - Published to npm (public package)
- **misuzu-web** - Not published (private application)
- **Internal packages** - Use `workspace:*` for dependencies

### Technology Stack

#### Build & Development

| Layer        | Technology      | Purpose                       |
| ------------ | --------------- | ----------------------------- |
| **Build**    | Vite + Rolldown | Fast bundling and compilation |
| **Bundler**  | tsdown          | TypeScript library bundling   |
| **Test**     | Vitest          | Fast unit testing             |
| **Format**   | Oxfmt           | Code formatting               |
| **Lint**     | Oxlint          | Static analysis               |
| **Language** | TypeScript      | Type safety                   |

#### Frontend

| Layer             | Technology   | Purpose                 |
| ----------------- | ------------ | ----------------------- |
| **Framework**     | Vue 3        | Reactive UI components  |
| **Routing**       | Vue Router   | Client-side routing     |
| **State**         | Pinia        | Global state management |
| **Styling**       | Tailwind CSS | Utility-first CSS       |
| **UI Components** | shadcn-vue   | Pre-built components    |
| **Icons**         | Lucide Vue   | Icon library            |

#### Backend

| Layer            | Technology | Purpose                   |
| ---------------- | ---------- | ------------------------- |
| **Framework**    | Hono       | Lightweight web framework |
| **Runtime**      | Node.js    | JavaScript runtime        |
| **WebSocket**    | Hono WS    | Real-time communication   |
| **DI Container** | Custom     | Dependency injection      |

### Design Principles

#### 1. **Monorepo-First**

- Single repository for all related packages
- Shared configuration and tooling
- Simplified dependency management

#### 2. **Type Safety**

- Strict TypeScript everywhere
- No implicit `any` types
- Type-first API design

#### 3. **Modularity**

- Clear separation of concerns
- Independent, composable modules
- Minimal coupling between packages

#### 4. **Developer Experience**

- Unified CLI (Vite+) for all commands
- Fast builds and tests
- Clear error messages

#### 5. **Scalability**

- Workspace structure supports growth
- Easy to add new packages
- Performance optimized by default

### Data Flow

#### Request-Response Flow (Web App)

```
User Action (Click, Form)
    ↓
Vue Component emits action
    ↓
Pinia Store updates state
    ↓
API Service makes HTTP request to backend
    ↓
Hono Route handles request
    ↓
Service layer processes business logic
    ↓
Response sent back to client
    ↓
Store updates with response
    ↓
Component re-renders with new state
```

#### Real-time Flow (WebSocket)

```
Server-side event occurs
    ↓
Event emitted on EventBus
    ↓
WorkspaceManager publishes to WebSocket topic
    ↓
Client receives message on WebSocket
    ↓
Pinia Store updates with data
    ↓
Component automatically re-renders
```

#### Build Flow

```
Source Code (.ts, .vue)
    ↓
Vite processes & compiles
    ↓
Rolldown bundles modules
    ↓
Oxfmt formats output
    ↓
Dist folder with built assets
```

### Extension Points

#### Adding New Features to misuzu-core

1. **Create feature directory**:

   ```
   src/features/[feature-name]/
   ├── index.ts        # Exports
   ├── types.ts        # Type definitions
   ├── [feature].ts    # Implementation
   └── [feature].test.ts
   ```

2. **Export from index.ts**:

   ```typescript
   export { MyFeature } from "./my-feature.ts"
   export type { MyFeatureOptions } from "./types.ts"
   ```

3. **Add tests** with `.test.ts` suffix

#### Adding New Routes to misuzu-web

1. **Create route file**:

   ```
   src/client/views/[FeatureName]View.vue
   ```

2. **Add to router**:

   ```typescript
   // src/client/router.ts
   {
     path: '/feature',
     component: () => import('./views/FeatureView.vue')
   }
   ```

3. **Create composable** if needed:
   ```
   src/client/composables/use-feature.ts
   ```

#### Adding New API Endpoints

1. **Add backend route**:

   ```typescript
   // src/server/routes/api.ts
   app.post("/api/feature", async (c) => {
     // Handle request
   })
   ```

2. **Add client service method**:

   ```typescript
   // src/client/services/feature-api.ts
   export async function getFeature() {
     return api.get("/api/feature")
   }
   ```

3. **Add to Pinia store** if it's global state

#### Adding New UI Components

1. **Use shadcn-vue**:

   ```bash
   npx shadcn-vue@latest add component-name
   ```

2. **Or create custom**:

   ```
   src/client/components/[ComponentName].vue
   ```

3. **Document in Storybook** (if available)

### Dependency Management

#### Workspace Dependencies

Reference packages within the workspace:

```json
{
  "dependencies": {
    "misuzu-core": "workspace:*"
  }
}
```

#### Adding External Dependencies

```bash
# To root workspace
vp add package-name

# To specific package
cd packages/misuzu-core
vp add package-name

# As dev dependency
vp add -D package-name
```

#### Version Catalog

Versions are pinned in root `package.json`:

```json
{
  "catalog": {
    "vue": "^3.5.0",
    "typescript": "^5.0.0"
  }
}
```

### Performance Considerations

#### Frontend

- **Lazy Loading**: Route-based code splitting
- **State Management**: Only keep active state in memory
- **WebSocket**: Debounced updates to reduce re-renders
- **Build**: Tree-shaking removes unused code

#### Backend

- **DI Container**: Singleton pattern for services
- **Event Bus**: Pub/Sub for decoupled communication
- **Caching**: Store workspace registries in memory with file backup

#### Build

- **Incremental Builds**: Only rebuild changed packages
- **Watch Mode**: Fast HMR for development
- **Production**: Minified, optimized output

### Testing Architecture

#### Unit Tests

- Located alongside source code (`.test.ts` suffix)
- Use Vitest for fast execution
- Test individual modules in isolation

#### Integration Tests

- Test interactions between modules
- Mock external dependencies
- Verify API contracts

#### E2E Tests

- Full application flow testing
- Browser automation (if needed)
- Can be added to `examples/` directory

### Documentation Architecture

```
Root Level:
├── README.md              # Project overview
├── CONTRIBUTING.md        # Contribution guidelines
├── DEVELOPMENT.md         # Development setup
├── ARCHITECTURE.md        # This file
├── SECURITY.md            # Security policy
└── LICENSE                # Project license

Package Level:
├── packages/misuzu-core/README.md
└── apps/misuzu-web/README.md

Code-level:
├── JSDoc comments         # Function documentation
├── Type definitions       # Self-documenting types
└── Examples in README     # Usage examples
```

### Migration and Versioning

#### Semantic Versioning

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features
- **PATCH** (1.0.0 → 1.0.1): Bug fixes

#### Breaking Changes

Always provide:

1. Deprecation notice in previous version
2. Migration guide
3. Examples of old vs new code

---

## Chinese

本文档描述了 Misuzu 的高级架构并解释了其组件如何交互。

### 目录

1. [概述](#概述)
2. [Monorepo 结构](#monorepo-结构)
3. [包的相互作用](#包的相互作用)
4. [技术栈](#技术栈)
5. [设计原则](#设计原则)
6. [数据流](#数据流)
7. [扩展点](#扩展点)

### 概述

Misuzu 组织为一个 monorepo，具有清晰的分离：

- **库** (`packages/`) - 可复用的、可发布的代码
- **应用** (`apps/`) - 面向最终用户的应用程序
- **工具** (`tools/`) - 内部开发实用程序
- **插件** (`plugins/`) - 可扩展的功能

### Monorepo 结构

```
misuzu/
├── packages/
│   └── misuzu-core/
│       ├── src/
│       │   ├── index.ts           # 主入口点
│       │   ├── [features]/        # 功能模块
│       │   └── utils/             # 共享工具
│       ├── dist/                  # 构建输出
│       └── package.json
│
├── apps/
│   └── misuzu-web/
│       ├── src/
│       │   ├── client/            # Vue 前端
│       │   ├── server/            # Hono 后端
│       │   └── shared/            # 共享类型
│       └── package.json
│
├── tools/                         # 内部工具
├── plugins/                       # 插件系统
├── examples/                      # 示例代码
│
└── [配置文件]
    ├── package.json               # 根工作区
    ├── pnpm-workspace.yaml        # 工作区配置
    ├── vite.config.ts             # 构建配置
    └── tsconfig.json              # TypeScript 配置
```

### 包的相互作用

#### 依赖图

```
misuzu-web
  ├── depends on: misuzu-core
  ├── depends on: Vue 3
  ├── depends on: Hono
  └── depends on: Tailwind CSS

misuzu-core
  ├── depends on: TypeScript
  └── minimal external dependencies
```

#### 发布策略

- **misuzu-core** - 发布到 npm（公开包）
- **misuzu-web** - 不发布（私有应用）
- **内部包** - 对依赖使用 `workspace:*`

### 技术栈

#### 构建和开发

| 层         | 技术            | 目的              |
| ---------- | --------------- | ----------------- |
| **构建**   | Vite + Rolldown | 快速捆绑和编译    |
| **打包器** | tsdown          | TypeScript 库打包 |
| **测试**   | Vitest          | 快速单元测试      |
| **格式**   | Oxfmt           | 代码格式化        |
| **Lint**   | Oxlint          | 静态分析          |
| **语言**   | TypeScript      | 类型安全          |

#### 前端

| 层          | 技术         | 目的           |
| ----------- | ------------ | -------------- |
| **框架**    | Vue 3        | 响应式 UI 组件 |
| **路由**    | Vue Router   | 客户端路由     |
| **状态**    | Pinia        | 全局状态管理   |
| **样式**    | Tailwind CSS | 工具优先 CSS   |
| **UI 组件** | shadcn-vue   | 预构建组件     |
| **图标**    | Lucide Vue   | 图标库         |

#### 后端

| 层            | 技术    | 目的              |
| ------------- | ------- | ----------------- |
| **框架**      | Hono    | 轻量级网页框架    |
| **运行时**    | Node.js | JavaScript 运行时 |
| **WebSocket** | Hono WS | 实时通信          |
| **DI 容器**   | 自定义  | 依赖注入          |

### 设计原则

#### 1. **Monorepo 优先**

- 所有相关包的单个仓库
- 共享配置和工具
- 简化的依赖管理

#### 2. **类型安全**

- 到处都是严格的 TypeScript
- 无隐式 `any` 类型
- 类型优先的 API 设计

#### 3. **模块化**

- 清晰的关注点分离
- 独立的、可组合的模块
- 最小的包之间耦合

#### 4. **开发者体验**

- 统一的 CLI（Vite+）用于所有命令
- 快速构建和测试
- 清晰的错误信息

#### 5. **可扩展性**

- 工作区结构支持增长
- 易于添加新包
- 默认性能优化

### 数据流

#### 请求-响应流（网页应用）

```
用户操作（点击、表单）
    ↓
Vue 组件发出操作
    ↓
Pinia 存储更新状态
    ↓
API 服务向后端发出 HTTP 请求
    ↓
Hono 路由处理请求
    ↓
服务层处理业务逻辑
    ↓
响应发送回客户端
    ↓
存储用响应更新
    ↓
组件使用新状态重新呈现
```

#### 实时流（WebSocket）

```
服务器端事件发生
    ↓
事件在 EventBus 上发出
    ↓
WorkspaceManager 发布到 WebSocket 主题
    ↓
客户端在 WebSocket 上接收消息
    ↓
Pinia 存储用数据更新
    ↓
组件自动重新呈现
```

#### 构建流

```
源代码（.ts、.vue）
    ↓
Vite 处理和编译
    ↓
Rolldown 捆绑模块
    ↓
Oxfmt 格式化输出
    ↓
dist 文件夹包含构建资产
```

### 扩展点

#### 为 misuzu-core 添加新功能

1. **创建功能目录**：

   ```
   src/features/[feature-name]/
   ├── index.ts        # 导出
   ├── types.ts        # 类型定义
   ├── [feature].ts    # 实现
   └── [feature].test.ts
   ```

2. **从 index.ts 导出**：

   ```typescript
   export { MyFeature } from "./my-feature.ts"
   export type { MyFeatureOptions } from "./types.ts"
   ```

3. **添加测试** 使用 `.test.ts` 后缀

#### 为 misuzu-web 添加新路由

1. **创建路由文件**：

   ```
   src/client/views/[FeatureName]View.vue
   ```

2. **添加到路由**：

   ```typescript
   // src/client/router.ts
   {
     path: '/feature',
     component: () => import('./views/FeatureView.vue')
   }
   ```

3. **创建 composable** 如果需要：
   ```
   src/client/composables/use-feature.ts
   ```

#### 添加新 API 端点

1. **添加后端路由**：

   ```typescript
   // src/server/routes/api.ts
   app.post("/api/feature", async (c) => {
     // 处理请求
   })
   ```

2. **添加客户端服务方法**：

   ```typescript
   // src/client/services/feature-api.ts
   export async function getFeature() {
     return api.get("/api/feature")
   }
   ```

3. **添加到 Pinia 存储** 如果它是全局状态

#### 添加新 UI 组件

1. **使用 shadcn-vue**：

   ```bash
   npx shadcn-vue@latest add component-name
   ```

2. **或创建自定义**：

   ```
   src/client/components/[ComponentName].vue
   ```

3. **在 Storybook 中记录**（如果可用）

### 依赖管理

#### 工作区依赖

引用工作区内的包：

```json
{
  "dependencies": {
    "misuzu-core": "workspace:*"
  }
}
```

#### 添加外部依赖

```bash
# 到根工作区
vp add package-name

# 到特定包
cd packages/misuzu-core
vp add package-name

# 作为开发依赖
vp add -D package-name
```

#### 版本目录

版本在根 `package.json` 中固定：

```json
{
  "catalog": {
    "vue": "^3.5.0",
    "typescript": "^5.0.0"
  }
}
```

### 性能考虑

#### 前端

- **延迟加载**：基于路由的代码分割
- **状态管理**：在内存中仅保留活跃状态
- **WebSocket**：防抖更新以减少重新呈现
- **构建**：树摇动移除未使用的代码

#### 后端

- **DI 容器**：服务的单例模式
- **事件总线**：用于解耦通信的 Pub/Sub
- **缓存**：在内存中存储工作区注册表，带文件备份

#### 构建

- **增量构建**：仅重建已更改的包
- **监听模式**：快速的开发中 HMR
- **生产**：最小化的、优化的输出

### 测试架构

#### 单元测试

- 位于源代码旁边（`.test.ts` 后缀）
- 使用 Vitest 实现快速执行
- 隔离测试各个模块

#### 集成测试

- 测试模块之间的交互
- 模拟外部依赖
- 验证 API 契约

#### E2E 测试

- 完整的应用流程测试
- 浏览器自动化（如果需要）
- 可以添加到 `examples/` 目录

### 文档架构

```
根级别：
├── README.md              # 项目概述
├── CONTRIBUTING.md        # 贡献指南
├── DEVELOPMENT.md         # 开发设置
├── ARCHITECTURE.md        # 本文件
├── SECURITY.md            # 安全策略
└── LICENSE                # 项目许可证

包级别：
├── packages/misuzu-core/README.md
└── apps/misuzu-web/README.md

代码级别：
├── JSDoc 注释              # 函数文档
├── 类型定义               # 自记录类型
└── README 中的示例         # 使用示例
```

### 迁移和版本控制

#### 语义版本控制

- **MAJOR** (1.0.0 → 2.0.0)：破坏性更改
- **MINOR** (1.0.0 → 1.1.0)：新功能
- **PATCH** (1.0.0 → 1.0.1)：Bug 修复

#### 破坏性更改

始终提供：

1. 上一版本的弃用通知
2. 迁移指南
3. 旧代码与新代码的示例
