# ctf-runtime 说明（人话版）

对应英文版：`README.md`

这份文档不讲太多术语，目标只有一个：让第一次看这块代码的人，10 分钟内知道它在做什么、为什么这么做、哪里容易踩坑。

## 这块代码到底是干嘛的

把它想成一个“总控台”：

- 一边连 CTF 平台（登录、选比赛、拉题目、拉公告）
- 一边管 solver（给每道题分配 solver、安排任务）
- 中间有个队列（谁先跑、谁暂停、谁取消）
- 还要管模型资源（模型并发不超限）
- 最后把状态存盘（重启后能接着干）

主类是 `runtime-workspace.ts` 里的 `CTFRuntimeWorkspace`。

## 先看这个目录图

```text
ctf-runtime/
  workspace.ts                  # 对外入口（别人通常只 import 这个）
  runtime-workspace.ts          # 总控台主逻辑
  factory.ts                    # 创建 workspace
  register-services.ts          # 把各个 service 组装起来
  persistence.ts                # 读写状态文件
  state.ts                      # 状态结构定义
  environment-runtime-state.ts  # EnvironmentAgent 相关状态处理
  services/
    platform/                   # 跟平台打交道
    scheduler/                  # 队列 + 排队策略
    model/                      # 模型池
    solver/                     # solver 工作区
```

## 三个最重要的运行场景

### 场景 1：正常启动

1. `factory.ts` 创建 `CTFRuntimeWorkspace`
2. `initPersistence()` 从磁盘读取上次状态
3. 按优先级拿运行配置：
   - 代码里直接传入
   - 上次保存的配置
   - `platform.json`
4. 如果拿到了平台配置，就 `initializeRuntime()` 开始跑

### 场景 2：运行中

- 任务进队列 -> 找到空闲 solver -> 执行
- 题目或公告同步会更新状态
- 状态变化不会每次都立刻写盘，而是做了 600ms 合并写入（防止频繁 IO）

### 场景 3：平台插件还没准备好 / 出 bug

- 可以先挂一个 `EnvironmentAgent`
- 它的对话、提示词、模型信息会单独保存
- 后面就算切到平台 runtime 继续跑，这份 EnvironmentAgent 状态也会保留
- 未来插件有问题，可以再拉起 EnvironmentAgent 继续修

这就是你们最关心的“兜底通道”。

## EnvironmentAgent 状态现在怎么保留

现在状态文件里分成两块：

- `environmentRuntimeState`：专门存 EnvironmentAgent
- `runtimeState`：存当前非 environment 的 runtime（比如平台 runtime）

重点是：

- 保存平台 runtime 时，不会覆盖 `environmentRuntimeState`
- 所以插件上线后，EnvironmentAgent 历史上下文依然在

相关文件：

- 结构定义：`state.ts`
- 持久化写入：`persistence.ts`
- 保留逻辑：`runtime-workspace.ts`

## 你可以把核心流程理解成一句话

“平台 runtime 负责跑业务，EnvironmentAgent 负责兜底修复，两者状态分开存，互不覆盖。”

## 常见疑问（审阅时经常会问）

### 1) 为什么恢复时要检查插件 id？

避免把 A 平台的历史快照，错恢复到 B 平台上。

### 2) 为什么要过滤已解题任务？

重启后不应该把已经 solved 的题再跑一遍。

### 3) 为什么有 debounce 写盘？

队列/solver 状态变化很频繁，不合并会导致大量磁盘写入。

### 4) 为什么 EnvironmentAgent 状态要单独存？

因为它不是“过渡垃圾”，而是长期可回收的修复上下文。

## 快速审阅清单（按优先级）

1. `workspace.ts` 对外 API 有没有被破坏
2. `runtime-workspace.ts` 的生命周期顺序有没有变
3. `state.ts` 结构是否改动，兼容性是否说明清楚
4. 平台 runtime 持久化是否仍会保留 `environmentRuntimeState`
5. 队列语义是否还是 FIFO，取消逻辑是否被改坏

## 对应测试（遇事先看）

- `runtime-workspace.persistence.test.ts`
  - 持久化/恢复
  - `platform.json` 与 `$env:` 解析
  - EnvironmentAgent 状态跨 runtime 切换保留

- `services/platform/runtime.test.ts`
  - 平台初始化和集成行为

- `services/scheduler/queue.test.ts`
  - 队列顺序和取消语义

## 给新同学的阅读顺序（最省时间）

1. `workspace.ts`
2. `runtime-workspace.ts`
3. `state.ts` + `persistence.ts`
4. `services/platform/hub.ts`
5. `services/scheduler/queue.ts`

如果只给你 10 分钟：看“运行场景”+“EnvironmentAgent 状态怎么保留”+“快速审阅清单”。
