# Solver / Coordinator 实现方案（基于当前 Misuzu 代码）

## 1. 文档目标

在 `FeaturedAgent` 现有基础上，落地最小可用的 `SolverAgent`，并将 workspace 主 Agent 创建能力从“直接创建 `FeaturedAgent`”演进为“仅支持创建 `Solver` 或 `Coordinator`”。

同时为后续 CTF 平台插件化（登录、题目抓取、附件下载、flag 提交限流、公告抓取等）提供清晰扩展点。

---

## 2. 当前代码基线（需要承接的现实）

### 2.1 Agent 侧

- `packages/misuzu-core/src/agents/featured.ts` 已提供通用 Agent 包装（工具、技能、日志、上下文压缩、模型 API key 解析）。
- `packages/misuzu-core/src/agents/solver.ts` 目前仅有空壳：`class SolverAgent extends FeaturedAgent {}`。
- 尚无 `CoordinatorAgent`。

### 2.2 Workspace 侧

- `packages/misuzu-core/src/core/application/workspace/index.ts`
  - `mainAgent?: FeaturedAgent`
  - `createMainAgent(options?: FeaturedAgentOptions)` 只会创建 `FeaturedAgent`
  - `createMainAgentInternal` 固定加载 `role: "shared"` 的 skills。

### 2.3 持久化侧

- `packages/misuzu-core/src/core/application/persistence/store.ts`
  - `PersistedWorkspaceState.mainAgent?: PersistedFeaturedAgentState`
  - 结构未区分 agent kind（solver / coordinator）。
- `AgentStateProxy` 逻辑目前绑定 `FeaturedAgent` 类型（可复用，因为子类继承即可）。

### 2.4 Tooling 侧

- `createBaseTools(cwd)` 提供读写改查与 shell。
- 当前“sandbox”概念主要依赖 `cwd` 约束，但路径解析支持绝对路径，尚不是严格隔离。

---

## 3. 目标拆解（按你提出的需求）

1. 通过继承 `FeaturedAgent` 实现最简单 `SolverAgent`。
2. 扩展 `workspace.createMainAgent`：支持明确创建 `Solver`/`Coordinator`。
3. Solver 两种创建路径：
   - 作为 top workspace main agent（独立 Solver）
   - 由 Coordinator 创建（受协调 Solver）
4. 两种 Solver 行为差异必须可配置：
   - system prompt 是否提及 coordinator
   - 是否注入 coordinator 侧环境工具
5. Solver 解题闭环：解题 -> 提交 flag -> 正确则写 writeup / 清理 / 汇报。
6. 为 CTF 平台适配保留插件接口（登录、题目、附件、公告、容器、提交限流）。

---

## 4. 推荐总体设计（方案 A，推荐）

## 4.1 新增 Agent 类型与统一 MainAgent 类型

新增：

- `packages/misuzu-core/src/agents/solver.ts`（从空壳补齐）
- `packages/misuzu-core/src/agents/coordinator.ts`（新增）

核心类型：

```ts
export type MainAgentKind = "solver" | "coordinator"

export type MainAgent = SolverAgent | CoordinatorAgent
```

`Workspace.mainAgent` 从 `FeaturedAgent` 改为 `MainAgent`。

---

## 4.2 createMainAgent API 变更

将当前 API 从“隐式 Featured”改为“显式 kind”。

```ts
export interface CreateSolverMainAgentOptions extends SolverAgentOptions {
  kind: "solver"
}

export interface CreateCoordinatorMainAgentOptions extends CoordinatorAgentOptions {
  kind: "coordinator"
}

export type CreateMainAgentOptions =
  | CreateSolverMainAgentOptions
  | CreateCoordinatorMainAgentOptions
```

`Workspace.createMainAgent(options)`：

- `kind === "solver"` -> 创建 `SolverAgent`
- `kind === "coordinator"` -> 创建 `CoordinatorAgent`
- 不再接受 `FeaturedAgentOptions` 直传

> 兼容建议：先给一版过渡（见第 8 节分阶段计划），最终移除直接 `FeaturedAgent` 创建。

---

## 4.3 Solver 双创建模式

为 `SolverAgent` 增加上下文配置：

```ts
export type SolverSpawnMode = "standalone" | "coordinated"

export interface SolverCoordinatorContext {
  coordinatorId: string
  injectedTools?: AgentTool<any>[]
  notifyEnvExpiredToolName?: string
  notifySolvedToolName?: string
}

export interface SolverAgentOptions extends FeaturedAgentOptions {
  spawnMode?: SolverSpawnMode
  coordinatorContext?: SolverCoordinatorContext
}
```

行为规则：

- `standalone`
  - prompt 不提及 coordinator
  - tools = solver sandbox tools（基础工具 + solver 专属工具）
- `coordinated`
  - prompt 明确“你由 coordinator 调度，可请求刷新环境”
  - tools = solver sandbox tools + `coordinatorContext.injectedTools`

---

## 4.4 Solver 最小提示词策略（防误拒绝）

`SolverAgent` 内置一段安全导向提示词模板（在原系统 prompt 前后拼接）：

- 明确任务是 **CTF 授权环境**（非真实未授权攻击）
- 明确目标是 **题目解题与验证**（不做无关扫描）
- 明确成功标准：产出可提交 flag 与简短 writeup
- 若 `coordinated`，增加“可通过工具通知 coordinator 刷新容器/环境”

这样可以显著减少模型把任务误判为现实攻击而拒答。

---

## 4.5 Coordinator 责任落地点

`CoordinatorAgent`（同样继承 `FeaturedAgent`）主要负责：

1. 题目调度：按并发与容器上限创建 solver
2. 环境分发：为 solver 注入题目上下文和环境工具
3. 生命周期监听：接收 solver solved/expired 事件并更新队列
4. （低优先）进度汇报给用户

推荐引入轻量运行时对象：`CoordinatorRuntime`（非 Agent 子类），由 `CoordinatorAgent` 使用。

---

## 4.6 CTF 平台插件接口（关键）

建议新增目录：`packages/misuzu-core/src/platforms/ctf/`

### 核心接口

```ts
export interface CtfPlatformPlugin {
  id: string
  displayName: string
  createSession(options: CtfPlatformSessionOptions): Promise<CtfPlatformSession>
}

export interface CtfPlatformSession {
  login(input: LoginInput): Promise<LoginResult>
  getContestInfo(): Promise<ContestInfo>
  getContainerLimit(): Promise<{ maxContainers: number | null }>
  listChallenges(): Promise<ChallengeSummary[]>
  getChallenge(challengeId: string): Promise<ChallengeDetail>
  downloadAttachment(input: { challengeId: string; attachmentId: string }): Promise<DownloadedFile>
  fetchAnnouncements(input?: { since?: string }): Promise<Announcement[]>
  submitFlag(input: SubmitFlagInput): Promise<SubmitFlagResult>
  refreshChallengeEnvironment?(input: { challengeId: string }): Promise<ChallengeEnvironment>
}
```

### flag 提交限流（滑动窗口）

新增 `FlagSubmissionLimiter`：

- 以 `challengeId + solverId` 或 `challengeId` 作为键
- 参数示例：`windowMs`, `maxAttemptsPerWindow`, `minIntervalMs`
- 放在 Coordinator 或 PlatformSession 之上统一拦截，避免 Solver 暴力提交

---

## 4.7 Environment Agent 的定位

你给出的流程里，未适配平台时需要 environment agent 做平台适配并产出子 workspace。

这里有一个与“main agent 仅 solver/coordinator”的冲突，建议二选一：

1. **推荐**：Environment 作为“引导阶段专用 Agent”，不走 `createMainAgent`（单独 `createBootstrapAgent` 或 CLI 子命令）
2. 将 Environment 收敛成 Coordinator 的一种 mode（`coordinatorMode: "adapter" | "orchestrator"`）

为避免主链路复杂度暴涨，建议先采用选项 1。

---

## 5. 需要修改的现有文件（精确到路径）

### 必改

1. `packages/misuzu-core/src/agents/solver.ts`
   - 补齐 `SolverAgent` 构造与 mode 逻辑
2. `packages/misuzu-core/src/core/application/workspace/index.ts`
   - `mainAgent` 类型改为 `MainAgent`
   - `createMainAgent` 参数改为 `CreateMainAgentOptions`
   - 内部分支创建 solver/coordinator
3. `packages/misuzu-core/src/core/application/persistence/store.ts`
   - mainAgent 持久化结构从单一 `PersistedFeaturedAgentState` 演进到带 `kind` 的 union
4. `packages/misuzu-core/src/core/application/persistence/json-adapter.ts`
   - 读写 `mainAgent.kind`
   - 旧状态兼容迁移逻辑（可选但强烈建议）
5. `packages/misuzu-core/src/index.ts`
   - 导出 `SolverAgent` / `CoordinatorAgent` / 新的 createMainAgent 类型

### 新增

1. `packages/misuzu-core/src/agents/coordinator.ts`
2. `packages/misuzu-core/src/platforms/ctf/*`（插件接口与 registry）
3. `packages/misuzu-core/src/coordinator/*`（runtime、scheduler、solver-factory、limiter）

### 测试补充

1. `packages/misuzu-core/src/core/application/workspace/index.test.ts`
   - 覆盖 `createMainAgent({ kind: ... })`
   - 覆盖禁止直接 Featured 创建
2. 新增 `solver.test.ts`
   - standalone/coordinated prompt 差异
   - injected tools 差异
3. 新增 `coordinator` 相关测试
   - 并发限制
   - 容器上限限制
   - solver solved 后调度下一题
4. 新增 `flag-submission-limiter.test.ts`

---

## 6. 持久化模型建议

建议把当前：

```ts
mainAgent?: PersistedFeaturedAgentState
```

升级为：

```ts
type PersistedMainAgentState =
  | { kind: "solver"; solverMeta: PersistedSolverMeta; ...PersistedFeaturedAgentState }
  | { kind: "coordinator"; coordinatorMeta: PersistedCoordinatorMeta; ...PersistedFeaturedAgentState }
```

额外持久化建议：

- Solver: `spawnMode`, `challengeId`, `workspaceDir`, `parentCoordinatorId?`
- Coordinator: `queueState`, `activeSolvers`, `limits`, `pluginId`

这样恢复时可直接重建调度上下文，不仅恢复聊天消息。

---

## 7. 关键流程（MVP）

### 7.1 Top-level Solver

1. 用户创建 workspace
2. `createMainAgent({ kind: "solver", ... })`
3. Solver 使用 sandbox tools 解题
4. 调 `submitFlag` 工具 -> 成功则生成 writeup -> 清理环境 -> 汇报

### 7.2 Coordinator -> Solver

1. `createMainAgent({ kind: "coordinator", pluginId, limits })`
2. Coordinator 拉取题目列表并入队
3. 按并发/容器上限 spawn solver（`spawnMode: "coordinated"`）
4. solver 使用注入环境工具，必要时 `notify_env_expired`
5. solver solved -> coordinator 更新状态 -> 调度下一个 solver

---

## 8. 分阶段实施计划（避免一次性改动过大）

### Phase 1（最小可运行）

- 完成 `SolverAgent`（standalone + coordinated 两种模式）
- `createMainAgent` 支持 `{ kind: "solver" | "coordinator" }`
- 暂时允许旧 `FeaturedAgentOptions` 但标记 deprecated，并打印 warn

### Phase 2（按你的要求收口）

- 删除旧签名与直接创建 `FeaturedAgent` 的分支
- 持久化状态改为 `kind` union，并加入迁移逻辑

### Phase 3（CTF 编排能力）

- 上线 `CoordinatorAgent` + `CoordinatorRuntime`
- 接入平台插件接口 + flag 提交滑动窗口限流

### Phase 4（平台自适配）

- 引入 Environment 引导流程（建议独立 bootstrap API）
- 产出子 workspace 并激活 coordinator

---

## 9. 备选方案

## 方案 B：保留单一 FeaturedAgent，角色靠 options 区分

- 做法：不新增 `SolverAgent/CoordinatorAgent` 类，只新增 `agentRole` 字段
- 优点：改动小、短期快
- 缺点：类型不清晰，后续 coordinator 复杂度会堆积在一个类里，维护成本高

适用：仅做临时 PoC。

## 方案 C：Workspace 外置 AgentFactory

- 做法：`Workspace` 不直接 new 任何 Agent，由 `MainAgentFactory` 负责
- 优点：依赖注入更清晰，便于测试与扩展更多 agent kind
- 缺点：首轮重构成本高于方案 A

适用：预期很快会有 Environment/Reviewer/Planner 等多角色时。

---

## 10. 风险与应对

1. **旧状态恢复失败风险**：旧持久化无 `kind`
   - 应对：添加迁移器，将旧状态映射为 `coordinator` 或 `solver`（可配默认）
2. **Solver 工具越权风险**：当前路径工具可访问绝对路径
   - 应对：新增受限工具包装层，默认限制在 workspace/subworkspace
3. **提交爆破风险**：多 solver 并发导致 flag 过量提交
   - 应对：统一经过 `FlagSubmissionLimiter`
4. **调度雪崩风险**：solver 异常退出后队列不推进
   - 应对：CoordinatorRuntime 里统一状态机 + watchdog 重试

---

## 11. 建议的首批落地顺序（工程上最稳）

1. 完成 `SolverAgent`（真正可实例化，支持两种 spawn mode）
2. 改造 `createMainAgent` 为 kind-based，并补测试
3. 新增 `CoordinatorAgent` 空实现 + minimal runtime（先只创建/跟踪 solver）
4. 定义平台插件接口与 limiter（先接口后实现）
5. 逐步接入真实 CTF 平台插件

这条路径能尽快交付你当前要的“最简单 Solver + main agent 角色收口”，同时不给后续 coordinator / 插件体系埋技术债。
