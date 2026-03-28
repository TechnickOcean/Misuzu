# Architecture

`misuzu-core` is a CTF automation runtime built on top of `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai`.
It provides a coordinator/solver multi-agent model with persistent local workspaces.

## What This Package Owns

- Agent orchestration (`Coordinator`, `Solver`, `FeaturedAgent`)
- Tool runtime (filesystem, shell, search, docker)
- Context compaction and custom message conversion
- Skill loading and skill catalog injection
- Workspace/session persistence and resume

## System Layers

1. **Application Agents**
   - `Coordinator`: challenge assignment, queueing, solver supervision, flag confirmation
   - `Solver`: single-challenge execution and artifact generation
2. **Agent Foundation**
   - `FeaturedAgent`: wraps `pi-agent-core` `Agent` with skills, compaction, persistence hooks
3. **Platform Services**
   - Tools, skills, compaction, persistence, provider adapter
4. **Underlying Runtime**
   - `pi-agent-core` event loop and tool-call lifecycle
   - `pi-ai` models/providers and message streaming

## Runtime Behavior (High Level)

1. User prompts `Coordinator`
2. Coordinator calls `create_solver` for challenges
3. Each solver gets a dedicated workspace and runs asynchronously
4. Solver reports candidate flags via custom messages/tool calls
5. Coordinator confirms/rejects flags and updates solver state
6. Persistence continuously records sessions/state for resume

## Solver Lifecycle Semantics

- Solver end reason is derived from run events (`turn_end` primarily, `agent_end` as fallback)
- `stop` / `length`: solver remains active (`solving`), model slot is retained
- `error` / `aborted`: solver marked `failed`, model slot released
- `solved`: finalized and slot released
- Queue dispatch is deterministic when a slot becomes available

## Package Structure

```text
packages/misuzu-core/src/
  agents/       # FeaturedAgent, Coordinator, Solver
  features/     # compaction, messages, persistence, skills
  tools/        # base tools + docker tools + tool utils
  providers/    # model provider adapter
  index.ts      # public API barrel
```

## Public API (from `src/index.ts`)

### Agents

- `FeaturedAgent`, `FeaturedAgentOptions`
- `Solver`, `SolverOptions`
- `Coordinator`, `CoordinatorOptions`, `ResumeCoordinatorOptions`
- `ModelPool`, `ModelSlot`, `Challenge`

### Features

- Compaction: `checkCompact`, `compact`, `compactWithSummary`, `estimateTokens`, `estimateContextTokens`, `findCutPoint`
- Skills: `extractSkillFrontmatter`, `importSkillsFromDirectory`, `importSkillsFromDirectorySync`, `resolveMisuzuRoot`, `loadAgentSkills`, `loadBuiltinSkills`, `loadWorkspaceSkills`, `buildSkillsCatalog`
- Persistence: `SessionManager`, `AgentSessionRecorder`, `CompetitionPersistence`, `createWorkspaceId`, `defaultWorkspacesRoot`, `createCompetitionId`, `defaultCompetitionsRoot`
- Messages: `convertToLlm`, `FlagResultMessage`, `ChallengeUpdateMessage`, `CompactionSummaryMessage`

### Tools and Utilities

- Collections: `baseTools`, `readOnlyTools`
- Tool factories/defaults: `createBashTool`, `bashTool`, `createReadTool`, `readTool`, `createWriteTool`, `writeTool`, `createEditTool`, `editTool`, `createFindTool`, `findTool`, `createGrepTool`, `grepTool`
- Tool contracts: `BashOperations`, `BashToolDetails`, `ReadOperations`, `ReadToolDetails`, `WriteOperations`, `EditOperations`, `EditToolDetails`, `FindOperations`, `FindToolDetails`, `GrepToolDetails`
- Utility exports: `truncateHead`, `truncateTail`, `truncateLine`, `formatSize`, `TruncationResult`, `withFileMutationQueue`, `resolveToCwd`, `resolveReadPath`, `expandPath`
- CTF tools: `dockerTools`, `dockerBuildTool`, `dockerRunTool`, `dockerExecTool`, `dockerStopTool`, `dockerRmTool`

### Provider

- `ProxyProvider`, `ProxyProviderOptions`

## Design Constraints

- Workspace-first operation under `.misuzu/workspaces/...`
- Non-blocking solver startup from coordinator
- Explicit model-slot accounting via `ModelPool`
- File-backed challenge context (`ENVIRONMENT.md`) is authoritative
- Skills are in `systemPrompt` (not message history), so compaction does not remove them

## Related Docs

- `agents.md`: agent roles, lifecycle, and external methods
- `tools.md`: tool behavior contracts and failure semantics
- `compaction.md`: trigger rules and summary flow
- `persistence.md`: on-disk model and resume behavior
- `skills.md`: skill loading model and resolution rules
