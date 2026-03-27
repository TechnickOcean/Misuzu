# Agents

Misuzu uses a multi-agent architecture where a Coordinator manages multiple Solver agents. All agents extend `FeaturedAgent`, which wraps `pi-agent-core`'s `Agent` with skill loading, compaction, and custom message handling.

## Table of Contents

- [FeaturedAgent](#featuredagent)
- [Solver](#solver)
- [Coordinator](#coordinator)
- [Inter-Agent Communication](#inter-agent-communication)
- [Event Flow](#event-flow)
- [System Prompts](#system-prompts)

## FeaturedAgent

The base class for all misuzu agents. Wraps `pi-agent-core`'s `Agent` with:

- Skill catalog injection into system prompt
- Automatic compaction via `transformContext`
- Custom message type conversion via `convertToLlm`

```typescript
export interface FeaturedAgentOptions {
  initialState?: Partial<AgentState>
  skills?: Skill[]
  cwd?: string
  tools?: AgentTool<any>[]
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>
}
```

### Construction

```typescript
export class FeaturedAgent {
  private agent: Agent
  private skills: Skill[]
  private cwd: string

  constructor({ skills, cwd, tools, convertToLlm, ...opts }: FeaturedAgentOptions) {
    this.cwd = cwd ?? process.cwd()
    this.skills = skills ?? []

    // Build skill catalog in system prompt (protected from compaction)
    const skillCatalog = buildSkillsCatalog(this.skills)

    this.agent = new Agent({
      ...opts,
      initialState: {
        ...opts.initialState,
        systemPrompt: (opts.initialState?.systemPrompt ?? "") + skillCatalog,
        tools: tools ?? createBaseTools(this.cwd),
      },
      convertToLlm: convertToLlm ?? defaultConvertToLlm,
      transformContext: async (messages, signal) => {
        if (checkCompact(this.agent)) {
          return compact(this.agent)
        }
        return messages
      },
    })
  }
}
```

### Proxy Methods

FeaturedAgent exposes the inner `Agent`'s key methods:

```typescript
// State access
get state(): AgentState { return this.agent.state; }
get innerAgent(): Agent { return this.agent; }

// Event subscription
subscribe(fn: (e: AgentEvent) => void): () => void;

// Prompting
async prompt(...args: Parameters<Agent["prompt"]>): Promise<void>;

// Control
abort(): void;
async waitForIdle(): Promise<void>;

// State management
setTools(tools: AgentTool<any>[]): void;
setSystemPrompt(prompt: string): void;
setModel(model: Model<any>): void;
```

## Solver

An expert CTF player agent. Extends `FeaturedAgent` with Docker and base file/shell tools.

```typescript
export interface SolverOptions {
  cwd?: string
  challengeDescription?: string
  challengeUrl?: string
  sandboxImage?: string // Default: "ctf-sandbox"
  model?: Model<any>
}
```

### Construction

```typescript
export class Solver extends FeaturedAgent {
  constructor(options: SolverOptions) {
    const solverId = options.solverId ?? "solver"
    const cwd = options.cwd ?? resolve(process.cwd(), ".misuzu", "solvers", solverId)
    const sandboxImage = options.sandboxImage ?? "ctf-sandbox"

    super({
      ...options,
      cwd,
      tools: [...createBaseTools(cwd), ...dockerTools],
      initialState: {
        model: options.model,
        systemPrompt: buildSolverSystemPrompt(options),
      },
    })
  }

  async solve(challenge: string): Promise<void> {
    return this.prompt(challenge)
  }
}
```

### Solver System Prompt

The Solver's system prompt establishes the CTF expert persona:

```
You are an expert CTF player. Your goal is to find the flag for the given
challenge. The flag format is typically CTF{...} or flag{...}.

You have access to an isolated Docker container used for local testing and
exploit development.

Strategy:
1. Read `ENVIRONMENT.md` and local `attachments/` first
2. Build and run exploits in the Docker environment
3. Keep trying until you capture the flag

Never give up. If one approach fails, try another.
```

### Solver Workflow

```
1. Receive challenge assignment and initialize solver workspace
       │
       ▼
2. Read `ENVIRONMENT.md` and analyze `attachments/`
       │
       ▼
3. Build/start challenge containers if needed (docker_build/docker_run)
       │
       ▼
4. Develop and store scripts under `scripts/`, exploit target
       │
       ▼
5. Extract flag and report to Coordinator
       │
       ▼
6. After Coordinator confirms correctness, write reproducible `Writeups.md`
```

## Coordinator

The team manager agent. Extends `FeaturedAgent` with platform interaction tools and solver management.

```typescript
export interface CoordinatorOptions {
  cwd?: string
  workspaceRoot?: string
  workspaceId?: string
  ctfPlatformUrl?: string
  models?: string[]
  modelConcurrency?: number
  model?: Model<any>
  modelResolver?: (modelId: string) => Model<any> | undefined
}
```

### Construction

```typescript
export class Coordinator extends FeaturedAgent {
  private solvers: Map<string, Solver>

  constructor(options: CoordinatorOptions) {
    const cwd = options.cwd ?? process.cwd()

    super({
      ...options,
      cwd,
      tools: [...createReadOnlyTools(cwd), bashTool],
      initialState: {
        model: options.model,
        systemPrompt: buildCoordinatorSystemPrompt(options),
      },
    })

    this.solvers = options.solvers ?? new Map()
  }
}
```

### Coordinator System Prompt

```
You are a CTF team coordinator. Your job is to:

1. Navigate to the CTF platform and fetch all challenges
 with their titles, descriptions, attachments, categories and so on
2. Estimate difficulty and sort challenges (easiest first)
3. Assign Solver agents to challenges using create_solver
   - Each solver needs one model from the pool
   - If no models are available, challenges are queued automatically
4. When a solver finds a flag, submit it to the platform
5. Forward platform announcements to active solvers
6. Notify the user of progress

Workflow:
- Use `playwright-cli` skill (or `bash`) to navigate and extract challenge information
- Call create_solver for each challenge (easiest first)
- The system handles model allocation and queuing automatically
- Use bash to submit flags when solvers report them
- Do NOT monitor solver internals. Solvers are autonomous.
```

### Coordinator Capabilities

| Capability       | Implementation                                          |
| ---------------- | ------------------------------------------------------- |
| Fetch challenges | `bash` tool or `playwright-cli` skill                   |
| Assign solver    | `create_solver` tool (with model pool)                  |
| Create workspace | Initializes `.misuzu/workspaces/...` and solver subdirs |
| Maintain env     | `update_solver_environment` + URL validation            |
| Poll updates     | Script scaffold at `scripts/poll-platform-updates.sh`   |
| Send hint        | `solver.steer(hintMessage)`                             |
| Listen for flags | `solver.subscribe` for `FlagResultMessage`              |
| Receive flags    | `FlagResultMessage` custom messages                     |
| Confirm flag     | `confirm_solver_flag` (correct/rejected branches)       |
| Submit flag      | `bash` tool (curl to platform API)                      |
| Notify user      | Custom event emission                                   |

### Platform Polling Script Timing

`create_solver` completion is the trigger point for polling automation scaffold:

1. Coordinator creates solver workspace and copies attachments.
2. Coordinator writes `ENVIRONMENT.md` + `scripts/poll-platform-updates.sh`.
3. Solver may run the script manually (or schedule with cron/timer) via existing `bash` tool.
4. Script writes detected updates to `scripts/platform-updates.queue.md`.
5. Agent promotes relevant updates through `notify_coordinator` / `update_solver_environment`.

### Failure Branches

- **Flag rejected**: `confirm_solver_flag(correct=false)` keeps solver in solving state, records rejection, and steers solver to continue.
- **Environment URL validation failed**: coordinator records failure in `ENVIRONMENT.md`, does not overwrite current URL, and asks for a fresh URL.

### Resume API

Coordinator can be rehydrated from persisted workspace state:

```typescript
const coordinator = Coordinator.resumeFromWorkspace({
  workspaceDir: "<launch-cwd>/.misuzu/workspaces/<workspace-id>",
  autoContinueSolvers: true,
})
```

- Rebuilds coordinator message context from `coordinator/session.jsonl`.
- Restores queue/model pool from `coordinator/state.json`.
- Rehydrates solver agents from `coordinator/solvers/*` session/state files.

### Model Pool

The Coordinator manages a pool of model slots. By default, each listed model gets one slot (runs one solver at a time). Set `modelConcurrency` to allow each model to run multiple solvers concurrently.

If `models` is omitted but `model` is provided, the Coordinator automatically seeds the pool with that model ID so `create_solver` does not stall on an empty pool.

Example: `new Coordinator({ models: ["rightcode/gpt-5.4"], modelConcurrency: 3 })` allows three concurrent solvers on the same model entry.

```typescript
export interface ModelSlot {
  model: string // Provider/model-id, e.g. "anthropic/claude-sonnet-4-20250514"
  status: "idle" | "busy"
  solverId?: string // Which solver is using this model (if busy)
}

export class ModelPool {
  private slots: ModelSlot[]

  constructor(models: string[], options: { maxConcurrencyPerModel?: number } = {}) {
    const perModel = Math.max(1, Math.floor(options.maxConcurrencyPerModel ?? 1))
    this.slots = models.flatMap((model) =>
      Array.from({ length: perModel }, () => ({ model, status: "idle" as const })),
    )
  }

  /** Get the first idle model, or null if all busy */
  acquire(solverId: string): string | null {
    const slot = this.slots.find((s) => s.status === "idle")
    if (!slot) return null
    slot.status = "busy"
    slot.solverId = solverId
    return slot.model
  }

  /** Release a model back to the pool */
  release(solverId: string): void {
    const slot = this.slots.find((s) => s.solverId === solverId)
    if (slot) {
      slot.status = "idle"
      slot.solverId = undefined
    }
  }

  /** How many models are available */
  get available(): number {
    return this.slots.filter((s) => s.status === "idle").length
  }
}
```

### Assignment Workflow

The Coordinator follows this workflow to discover, prioritize, and assign challenges:

```
1. Fetch all challenges from platform
       │
       ▼
2. Estimate difficulty for each challenge
       │
       ▼
3. Sort by difficulty (easiest first)
       │
       ▼
4. For each challenge (in order):
   ├─ Is there an idle model in the pool?
   │   ├─ YES → create Solver, assign model, start solving
   │   └─ NO  → add to queue
   │
   ▼
5. When a solver finishes:
   ├─ Release model back to pool
   ├─ Check queue for next challenge
   └─ Assign if available
```

#### Step 1: Fetch Challenges

The Coordinator uses the `playwright-cli` skill or `bash` tool to scrape/fetch the challenge list:

```typescript
// Coordinator's system prompt includes instructions:
// "Use playwright-cli to navigate the platform, snapshot the challenge list,
//  and extract: challenge ID, name, category, description, files available."
```

#### Step 2: Estimate Difficulty

The Coordinator estimates difficulty from available signals. No single signal is reliable, so multiple are combined:

| Signal                         | Weight | Source                                                        |
| ------------------------------ | ------ | ------------------------------------------------------------- |
| Challenge category             | Medium | Platform label (crypto, pwn, web, forensics, reversing, misc) |
| File count and size            | Low    | Number/size of downloadable attachments                       |
| Challenge description keywords | High   | Words like "easy", "beginner", "advanced", "500pts"           |
| Point value                    | High   | If the platform assigns points (higher = harder)              |
| Solves count                   | Medium | More solves = easier (if available)                           |

Difficulty is scored 1-5:

```typescript
function estimateDifficulty(challenge: Challenge): number {
  let score = 3 // Default: medium

  // Point value (most reliable signal)
  if (challenge.points) {
    if (challenge.points <= 100) score = 1
    else if (challenge.points <= 200) score = 2
    else if (challenge.points <= 350) score = 3
    else if (challenge.points <= 450) score = 4
    else score = 5
  }

  // Description keywords
  const desc = challenge.description.toLowerCase()
  if (desc.includes("easy") || desc.includes("beginner") || desc.includes("intro"))
    score = Math.min(score, 2)
  if (desc.includes("hard") || desc.includes("advanced") || desc.includes("expert"))
    score = Math.max(score, 4)

  // Category adjustment
  if (challenge.category === "misc") score = Math.max(score, 2)

  return score
}
```

#### Step 3: Sort

Challenges are sorted by difficulty ascending. Within the same difficulty, order is preserved from the platform.

```typescript
challenges.sort((a, b) => a.difficulty - b.difficulty)
```

#### Step 4: Assign with Model Pool

```typescript
export class Coordinator extends FeaturedAgent {
  private modelPool: ModelPool
  private challengeQueue: Challenge[] = []
  private solvers: Map<string, Solver> = new Map()

  async assignChallenges(challenges: Challenge[]): Promise<void> {
    // Sort by difficulty
    challenges.sort((a, b) => a.difficulty - b.difficulty)

    for (const challenge of challenges) {
      const model = this.modelPool.acquire(challenge.id)

      if (model) {
        // Model available → start solver (non-blocking)
        this.startSolver(challenge, model)
      } else {
        // All models busy → queue
        this.challengeQueue.push(challenge)
      }
    }
  }

  private startSolver(challenge: Challenge, model: string): void {
    const solver = new Solver({
      cwd: path.join(MISUZU_WORKDIR, ".misuzu", "solvers", challenge.id),
      model: this.resolveModel?.(model) ?? this.state.model,
      challengeDescription: challenge.description,
    })

    this.solvers.set(challenge.id, solver)

    // Subscribe to solver events (flag detection only)
    solver.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "flagResult") {
        this.handleFlag(challenge.id, event.message as FlagResultMessage)
      }
      if (event.type === "agent_end") {
        this.onSolverFinished(challenge.id)
      }
    })

    // Start solving in background so Coordinator can keep dispatching.
    void solver.prompt(formatChallenge(challenge)).catch((error) => {
      this.handleSolverError(challenge.id, error)
    })
  }

  private onSolverFinished(solverId: string): void {
    // Release model back to pool
    this.modelPool.release(solverId)

    // Assign next queued challenge if available
    if (this.challengeQueue.length > 0 && this.modelPool.available > 0) {
      const next = this.challengeQueue.shift()!
      const model = this.modelPool.acquire(next.id)
      this.startSolver(next, model!)
    }
  }
}
```

### create_solver Tool

The Coordinator has a `create_solver` tool that the LLM can call during its agent loop. This is how the Coordinator's LLM drives the assignment process.

```typescript
const createSolverTool: AgentTool = {
  name: "create_solver",
  label: "Create Solver",
  description:
    "Create a new solver agent for a challenge. " +
    "Automatically selects an idle model from the pool. " +
    "Fails if no models are available.",
  parameters: Type.Object({
    challengeId: Type.String({ description: "Challenge ID from the platform" }),
    challengeName: Type.String({ description: "Challenge name" }),
    category: Type.String({
      description: "Challenge category (crypto, pwn, web, forensics, reversing, misc)",
    }),
    description: Type.String({ description: "Challenge description" }),
    difficulty: Type.Optional(
      Type.Number({ description: "Estimated difficulty 1-5 (auto-estimated if omitted)" }),
    ),
    files: Type.Optional(
      Type.Array(Type.String(), { description: "URLs to challenge attachments" }),
    ),
  }),
  async execute(_toolCallId, params) {
    const modelId = this.modelPool.acquire(params.challengeId)
    if (!modelId) {
      return {
        content: [{ type: "text", text: "No models available. Challenge queued." }],
        details: { queued: true },
      }
    }

    this.startSolver(
      { ...params, difficulty: params.difficulty ?? estimateDifficulty(params) },
      modelId,
    )

    return {
      content: [
        { type: "text", text: `Solver started for "${params.challengeName}" on model ${modelId}` },
      ],
      details: { model: modelId, solverId: params.challengeId },
    }
  },
}
```

### Typical Coordinator Session

```
User: Start the CTF competition at https://ctf.example.com/event/spring-2026

Coordinator:
  1. navigate to platform → snapshot → extract challenge list
  2. for each challenge, estimate difficulty
  3. sort by difficulty: [easy1, easy2, medium1, medium2, hard1]
  4. call create_solver(easy1) → model1 acquired → solver started
  5. call create_solver(easy2) → model2 acquired → solver started
  6. call create_solver(medium1) → model3 acquired → solver started
  7. call create_solver(medium2) → no models available → queued
  8. call create_solver(hard1) → no models available → queued

  ... time passes ...

  Solver for easy2 finishes → model2 released
  → Coordinator's followUp triggered: create_solver(medium2) → model2 acquired

  ... time passes ...

  Solver for easy1 finds flag → Coordinator submits flag → notifies user
  Solver for easy1 finishes → model1 released
  → Coordinator's followUp triggered: create_solver(hard1) → model1 acquired
```

## Inter-Agent Communication

The Coordinator and Solvers communicate through three channels, all provided by `pi-agent-core`.

### Channel A: Directive (Coordinator → Solver)

#### Starting Work: `prompt()`

Initiates a new solving task. The solver adds the message and runs its agent loop:

```typescript
const solver = new Solver({
  challengeDescription: "RSA with small exponent",
  cwd: path.join(MISUZU_WORKDIR, "/challenge-xx"),
})

// Start solving
await solver.prompt(`
  Challenge: babyRSA
  Category: crypto
  Files: chal.py, output.txt
  
  Find the flag.
`)
```

#### Mid-Run Hints: `steer()`

Interrupts the solver while it's running. The hint is delivered after the current tool calls finish, before the next LLM turn:

```typescript
// Coordinator detects solver is stuck in a loop
solver.steer("New hint published: it might be very small (e=3). Use Hastad's broadcast attack.")
```

**When `steer` is delivered:**

```
Solver timeline:
  [tool call 1] ──► [tool call 2] ──► [steer message injected] ──► [next LLM turn]
                                        ↑
                               hint arrives here
```

#### Queued Instructions: `followUp()`

Queues a message for after the solver finishes its current work naturally:

```typescript
// After solver finds a partial result
solver.followUp(
  "Now try the second part of the challenge - the decoded string looks like it needs base64 decoding.",
)
```

**When `followUp` is delivered:**

```
Solver timeline:
  [tool calls] ──► [no more tool calls] ──► [check followUp queue] ──► [followUp injected] ──► [next LLM turn]
```

#### Stopping: `abort()`

Immediately cancels the solver's current operation:

```typescript
// Flag was correct, stop all solvers
for (const [id, solver] of this.solvers) {
  solver.abort()
}
```

### Channel B: Observation (Solver → Coordinator)

#### Flag Detection

The Coordinator subscribes to each solver for flag results and completion events only. It does NOT monitor tool execution or assistant reasoning.

```typescript
solver.subscribe((event) => {
  if (event.type === "message_end" && event.message.role === "flagResult") {
    this.handleFlag(challengeId, event.message as FlagResultMessage)
  }
  if (event.type === "agent_end") {
    this.onSolverFinished(challengeId)
  }
})
```

#### Custom Messages

Solvers emit structured custom messages:

```typescript
// Solver emits when it finds a flag
solver.appendMessage({
  role: "flagResult",
  challengeId: "42",
  flag: "CTF{sm4ll_exponent_4tt4ck}",
  correct: true, // Updated after Coordinator submits
  message: "Found via Hastad's broadcast attack",
  timestamp: Date.now(),
})
```

The Coordinator only processes `FlagResultMessage` and `agent_end` events from solvers. All other solver activity is internal to the solver.

### Channel C: Bidirectional (Coordinator's Agent Loop)

Within the Coordinator's own agent loop, it manages the model pool and challenge queue:

```typescript
// When a solver finishes:
private onSolverFinished(solverId: string): void {
  // Release model back to pool
  this.modelPool.release(solverId);

  // Assign next queued challenge if available
  if (this.challengeQueue.length > 0 && this.modelPool.available > 0) {
    const next = this.challengeQueue.shift()!;
    const model = this.modelPool.acquire(next.id);
    this.startSolver(next, model!);
  }
}

// When a flag is found:
private handleFlag(challengeId: string, flag: FlagResultMessage): void {
  // Submit flag via bash tool in Coordinator's next turn
  this.appendMessage({
    role: "user",
    content: `Solver found flag for challenge ${challengeId}: ${flag.flag}. Submit it.`,
    timestamp: Date.now(),
  });
}
```

### Communication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Coordinator                              │
│                                                                  │
│  ┌─────────────┐   prompt()   ┌─────────────┐                   │
│  │             │─────────────►│             │                    │
│  │  Coordinator│   steer()    │  Solver A   │                    │
│  │             │─────────────►│  (crypto)   │                    │
│  │             │  followUp()  │             │                    │
│  │             │─────────────►│             │                    │
│  │             │◄─────────────│             │                    │
│  │             │  subscribe() │             │                    │
│  │             │  .messages   │             │                    │
│  └──────┬──────┘              └─────────────┘                    │
│         │                                                        │
│         │    prompt()    ┌─────────────┐                         │
│         ├───────────────►│             │                          │
│         │    steer()     │  Solver B   │                          │
│         ├───────────────►│  (pwn)      │                          │
│         │   followUp()   │             │                          │
│         ├───────────────►│             │                          │
│         │◄───────────────│             │                          │
│         │  subscribe()   │             │                          │
│         │  .messages     └─────────────┘                         │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                                 │
│  │  User       │  ← Coordinator emits events for UI/logging     │
│  │  notified   │                                                 │
│  └─────────────┘                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Summary Table

| Direction      | Method            | Timing                   | Use Case                                       |
| -------------- | ----------------- | ------------------------ | ---------------------------------------------- |
| Coord → Solver | `prompt()`        | Immediate                | Start solving a challenge                      |
| Coord → Solver | `steer()`         | After current tool calls | Forward platform hint/announcement             |
| Solver → Coord | `subscribe()`     | Event-driven             | Listen for `FlagResultMessage` and `agent_end` |
| Solver → Coord | `appendMessage()` | Event-driven             | Emit flag result                               |

## Event Flow

### Solver Event Sequence

```
solver.prompt("Solve challenge 42")
├─ agent_start
├─ turn_start
├─ message_start   { user: "Solve challenge 42" }
├─ message_end     { user }
├─ message_start   { assistant: "Let me analyze..." }
├─ ...
├─ tool_execution_start  { toolName: "docker_exec", args: {...} }
├─ tool_execution_end    { result: "output..." }
├─ turn_end
│
├─ turn_start
├─ message_end     { assistant: "Found the flag!" }
├─ turn_end
│
│  // Solver emits FlagResultMessage via appendMessage
│
└─ agent_end       { messages: [...] }
```

### Coordinator Event Sequence

```
coordinator.prompt("Start CTF at https://ctf.example.com")
├─ agent_start
├─ turn_start
├─ message_start      { assistant: "Navigating to platform..." }
├─ tool_execution     { bash/playwright-cli: fetch challenge list }
├─ message_end        { assistant: "Found 5 challenges. Sorting by difficulty..." }
│
│  // Coordinator calls create_solver for each challenge
│  // Model pool allocates idle models
│  // Queued challenges wait for available models
│
├─ message_start      { assistant: "Assigned 3 solvers, 2 queued." }
├─ tool_execution     { create_solver: easy1 → model1 }
├─ tool_execution     { create_solver: easy2 → model2 }
├─ tool_execution     { create_solver: medium1 → model3 }
├─ tool_execution     { create_solver: medium2 → "No models available, queued" }
├─ message_end
├─ turn_end
│
│  // Solvers run concurrently...
│  // Solver for easy2 finishes → model2 released → medium2 assigned
│  // Solver for easy1 finds flag → Coordinator receives FlagResultMessage
│
├─ turn_start
├─ message_start      { assistant: "Flag found for easy1! Submitting..." }
├─ tool_execution     { bash: curl -X POST ... }
├─ message_end        { assistant: "Flag accepted!" }
├─ turn_end
└─ agent_end
```

## System Prompts

### FeaturedAgent Base

System prompt construction is modular. The base prompt is concatenated with the skill catalog:

```typescript
function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  let prompt = options.customPrompt ?? defaultPrompt

  // Append skill catalog (protected from compaction)
  if (options.skills.length > 0) {
    prompt += formatSkillsForPrompt(options.skills)
  }

  // Append date and working directory
  prompt += `\nCurrent date: ${new Date().toISOString().slice(0, 10)}`
  prompt += `\nCurrent working directory: ${cwd}`

  return prompt
}
```

### Solver vs Coordinator

The two agents differ in persona, tools, and strategy guidance but share the same infrastructure:

| Aspect  | Solver               | Coordinator                 |
| ------- | -------------------- | --------------------------- |
| Persona | Expert CTF player    | Team manager                |
| Tools   | All base + docker    | Read-only + bash            |
| Goal    | Find flags           | Assign, supervise, submit   |
| Sandbox | Direct access        | No direct access            |
| Browser | Not typically needed | Uses `playwright-cli` skill |
