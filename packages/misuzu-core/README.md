# misuzu-core

> Core library for Misuzu agent workspaces: standalone solver mode and orchestrated CTF runtime mode.

[English](#english) | [中文](#中文)

---

## English

### Overview

`misuzu-core` provides the domain engine behind Misuzu:

- Agent wrappers (`FeaturedAgent`, `SolverAgent`, `EnvironmentAgent`)
- Workspace primitives (`SolverWorkspace`, `CTFRuntimeWorkspace`)
- Runtime orchestration (queueing, model-pool assignment, challenge lifecycle)
- Persistence adapters and typed snapshots
- Built-in plugin catalog loading (`gzctf` currently)

### Main Exports

```ts
import {
  createSolverWorkspace,
  createCTFRuntimeWorkspace,
  DEFAULT_SOLVER_PROMPT_TEMPLATE,
  JsonFilePersistenceAdapter,
  loadBuiltinPluginCatalog,
} from "misuzu-core"
```

### Workspace Modes

#### 1) Solver Workspace

Use this when you want one solver agent session.

```ts
import { createSolverWorkspace } from "misuzu-core"

const workspace = await createSolverWorkspace({
  rootDir: "/absolute/path/to/solver-workspace",
})

workspace.bootstrap()

// Optionally create main agent if provider/model are configured.
const model = workspace.getModel("openai", "gpt-4.1")
if (model && !workspace.mainAgent) {
  await workspace.createMainAgent({
    initialState: {
      model,
      systemPrompt: "Solve the challenge and keep notes in WriteUp.md",
    },
  })
}
```

#### 2) CTF Runtime Workspace

Use this when you need multi-challenge orchestration and queue control.

```ts
import { createCTFRuntimeWorkspace } from "misuzu-core"

const runtimeWorkspace = await createCTFRuntimeWorkspace({
  rootDir: "/absolute/path/to/runtime-workspace",
})

runtimeWorkspace.bootstrapProviders()

await runtimeWorkspace.setModelPoolItems([
  { provider: "openai", modelId: "gpt-4.1", maxConcurrency: 2 },
])

await runtimeWorkspace.initializeRuntime({
  pluginId: "gzctf",
  pluginConfig: {
    baseUrl: "https://example-ctf.com",
    contest: { mode: "id", value: 1 },
    auth: { mode: "manual" },
    maxConcurrentContainers: 2,
  },
  startPaused: true,
})

await runtimeWorkspace.syncChallengesOnce()
```

### Built-in Plugin Catalog

`misuzu-core` resolves plugin metadata from:

- `packages/misuzu-core/plugins/catalog.json`

Current built-in plugin:

- `gzctf`: adapter for GZCTF-like APIs (contest/challenge list, flag submit, notice polling, container open/destroy)

### Persistence and State

Runtime and agent state are persisted inside workspace directories under `.misuzu/`.

Important persisted artifacts include:

- provider config (`providers.json`)
- runtime/platform config (`platform.json`)
- runtime queue/scheduler snapshots
- solver messages and `WriteUp.md` files

### Development

From repository root:

```bash
vp run test -- packages/misuzu-core
vp run build -- packages/misuzu-core
```

From package directory:

```bash
cd packages/misuzu-core
vp test
vp pack
vp check
```

### Notes

- API is evolving with active refactors; pin to commit/tag in production.
- Some package metadata in `package.json` is still placeholder and will be finalized later.

### License

GPL-3.0. See `../../LICENSE`.

---

## 中文

### 概述

`misuzu-core` 是 Misuzu 的核心引擎，提供：

- Agent 封装（`FeaturedAgent`、`SolverAgent`、`EnvironmentAgent`）
- Workspace 抽象（`SolverWorkspace`、`CTFRuntimeWorkspace`）
- Runtime 编排（队列调度、模型池分配、挑战生命周期）
- 持久化与状态快照能力
- 内置平台插件目录加载（当前内置 `gzctf`）

### 主要导出

```ts
import {
  createSolverWorkspace,
  createCTFRuntimeWorkspace,
  DEFAULT_SOLVER_PROMPT_TEMPLATE,
  JsonFilePersistenceAdapter,
  loadBuiltinPluginCatalog,
} from "misuzu-core"
```

### 两种 Workspace 模式

#### 1) Solver Workspace

适用于单个 solver agent 会话。

```ts
import { createSolverWorkspace } from "misuzu-core"

const workspace = await createSolverWorkspace({
  rootDir: "/absolute/path/to/solver-workspace",
})

workspace.bootstrap()
```

#### 2) CTF Runtime Workspace

适用于多题并行与统一编排。

```ts
import { createCTFRuntimeWorkspace } from "misuzu-core"

const runtimeWorkspace = await createCTFRuntimeWorkspace({
  rootDir: "/absolute/path/to/runtime-workspace",
})

runtimeWorkspace.bootstrapProviders()
await runtimeWorkspace.setModelPoolItems([
  { provider: "openai", modelId: "gpt-4.1", maxConcurrency: 2 },
])
```

### 内置插件目录

插件元数据位于：

- `packages/misuzu-core/plugins/catalog.json`

当前内置插件：

- `gzctf`：适配 GZCTF 风格接口（题目同步、提交 flag、公告轮询、容器开关等）

### 持久化说明

工作区下 `.misuzu/` 目录会保存运行时状态，例如：

- `providers.json`
- `platform.json`
- 队列与调度快照
- solver 会话消息与 `WriteUp.md`

### 开发命令

仓库根目录：

```bash
vp run test -- packages/misuzu-core
vp run build -- packages/misuzu-core
```

包目录：

```bash
cd packages/misuzu-core
vp test
vp pack
vp check
```

### 备注

- 当前 API 仍在快速迭代，生产场景建议固定 commit/tag。
- `package.json` 中仍有部分占位信息，后续会清理。

### 许可证

GPL-3.0，见 `../../LICENSE`。
