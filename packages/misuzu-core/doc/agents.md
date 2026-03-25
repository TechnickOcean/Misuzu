# Agents

Misuzu uses a multi-agent architecture where a Coordinator manages multiple Solver agents. All agents extend `FeaturedAgent`, which wraps `pi-agent-core`'s `Agent` with skill loading, compaction, and custom message handling.

## Table of Contents

- [FeaturedAgent](#featuredagent)
- [Solver](#solver)
- [Coordinator](#coordinator)
- [Inter-Agent Communication](#inter-agent-communication)
- [Event Flow](#event-flow)
- [Self-Recovery](#self-recovery)
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

An expert CTF player agent. Extends `FeaturedAgent` with sandbox and Docker tools.

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
    const cwd = options.cwd ?? "/tmp/ctf-solver"
    const sandboxImage = options.sandboxImage ?? "ctf-sandbox"

    super({
      ...options,
      cwd,
      tools: [
        ...createBaseTools(cwd),
        sandboxStartTool,
        sandboxExecTool,
        sandboxUploadTool,
        sandboxDownloadTool,
        sandboxStopTool,
        dockerBuildTool,
        dockerRunTool,
        dockerExecTool,
      ],
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

// todo: perfect the prompts below
You have access to create an isolated Docker container with is used for local
test or used as a sandbox environment with pre-installed CTF tools (image-id: {build and fill}).

Strategy:
1. Analyze the challenge description and attachments
2. Build and run exploits in the sandbox
3. Keep trying until you capture the flag

Never give up. If one approach fails, try another.
```

### Solver Workflow

```
1. Receive challenge description & attachments
       │
       ▼
2. Analyze files if have (read, file, strings, binwalk)
       │
       ▼
3. Start sandbox if needed (sandbox_start)
       │
       ▼
4. Exploit
       │
       ▼
5. Extract flag
       │
       ▼
6. Emit FlagResultMessage ──► Coordinator receives it
```

## Coordinator

The team manager agent. Extends `FeaturedAgent` with platform interaction tools and solver management.

```typescript
export interface CoordinatorOptions {
  cwd?: string
  ctfPlatformUrl?: string
  model?: Model<any>
  solvers?: Map<string, Solver>
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
      tools: [
        ...createReadOnlyTools(cwd),
        bashTool,
        requestrepoCreateTool,
        requestrepoWaitTool,
        requestrepoSetFileTool,
        requestrepoAddDnsTool,
      ],
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
- Use agent-browser to navigate and extract challenge information
- Call create_solver for each challenge (easiest first)
- The system handles model allocation and queuing automatically
- Use bash to submit flags when solvers report them
- Do NOT monitor solver internals. Solvers are autonomous.
```

### Coordinator Capabilities

| Capability       | Implementation                             |
| ---------------- | ------------------------------------------ |
| Fetch challenges | `bash` tool or `agent-browser` skill       |
| Assign solver    | `create_solver` tool (with model pool)     |
| Send hint        | `solver.steer(hintMessage)`                |
| Listen for flags | `solver.subscribe` for `FlagResultMessage` |
| Receive flags    | `FlagResultMessage` custom messages        |
| Submit flag      | `bash` tool (curl to platform API)         |
| Notify user      | Custom event emission                      |

### Model Pool

The Coordinator manages a pool of models provided by the user. Each model can run one solver at a time. When all models are busy, new challenges are queued.

```typescript
export interface ModelSlot {
  model: string // Provider/model-id, e.g. "anthropic/claude-sonnet-4-20250514"
  status: "idle" | "busy"
  solverId?: string // Which solver is using this model (if busy)
}

export class ModelPool {
  private slots: ModelSlot[]

  constructor(models: string[]) {
    this.slots = models.map((model) => ({ model, status: "idle" }))
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

The Coordinator uses the `agent-browser` skill or `bash` tool to scrape/fetch the challenge list:

```typescript
// Coordinator's system prompt includes instructions:
// "Use agent-browser to navigate the platform, snapshot the challenge list,
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
        // Model available → start solver
        await this.startSolver(challenge, model)
      } else {
        // All models busy → queue
        this.challengeQueue.push(challenge)
      }
    }
  }

  private async startSolver(challenge: Challenge, model: string): Promise<void> {
    const solver = new Solver({
      cwd: path.join(MISUZU_WORKDIR, `/ctf-${challenge.id}`),
      model: getModel(model),
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

    // Start solving
    await solver.prompt(formatChallenge(challenge))
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
    const model = this.modelPool.acquire(params.challengeId)
    if (!model) {
      return {
        content: [{ type: "text", text: "No models available. Challenge queued." }],
        details: { queued: true },
      }
    }

    const solver = await this.startSolver(
      { ...params, difficulty: params.difficulty ?? estimateDifficulty(params) },
      model,
    )

    return {
      content: [
        { type: "text", text: `Solver started for "${params.challengeName}" on model ${model}` },
      ],
      details: { model, solverId: params.challengeId },
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
├─ tool_execution_start  { toolName: "sandbox_exec", args: {...} }
├─ tool_execution_end    { result: "output..." }
├─ turn_end
│
├─ turn_start
├─ message_end     { assistant: "Found the flag!" }
├─ turn_end
│
│  // Solver emits FlagResultMessage via appendMessage
│  // Solver self-recovery may fire if stuck (self-steer)
│
└─ agent_end       { messages: [...] }
```

### Coordinator Event Sequence

```
coordinator.prompt("Start CTF at https://ctf.example.com")
├─ agent_start
├─ turn_start
├─ message_start      { assistant: "Navigating to platform..." }
├─ tool_execution     { agent-browser: open, snapshot, extract challenges }
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

## Self-Recovery (will implement later)

The Solver is fully autonomous. It detects stuck conditions locally and self-recovers by injecting a reflection prompt into its own context. The Coordinator never monitors, evaluates, or intervenes in the solving process.

### Design Rationale

The Coordinator is a dispatcher — it assigns challenges, forwards platform hints, and submits flags. It does not understand individual challenges or solver strategies. Therefore, all stuck detection and recovery must be self-contained within the Solver.

Self-recovery works by having the Solver call `steer()` on itself. `steer()` queues a user-role message that is delivered after current tool calls finish, before the next LLM turn. The Solver's LLM sees its full history plus the reflection prompt, which redirects its attention without losing context.

```
Normal solver turn:
  [tool call] → [tool call] → [assistant: reasoning] → [next turn]

After self-recovery:
  [tool call] → [tool call] → [steer: reflection prompt] → [assistant: reassesses] → [next turn]
                                ↑
                     injected by Solver itself
```

### Triggering Conditions

Triggers are purely behavioral — no text parsing, no semantic analysis. Two signals, each with strict thresholds.

#### Signal 1: Failed Command Repetition

The same command is called repeatedly in a sliding window, and **all occurrences are failures**. This distinguishes debugging (run, fail, fix, run, succeed) from being stuck (run, fail, run, fail, run, fail).

```typescript
// Sliding window of last 8 tool calls, each stored as { fingerprint, isError }
window: [
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "read:py", isError: false },
  { fp: "edit:py", isError: false },
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "bash:python3 exploit_*.py", isError: true },
]

// "bash:python3 exploit_*.py" appears 5 times, ALL errors → trigger
```

Contrast with normal debugging:

```typescript
window: [
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "read:py", isError: false },
  { fp: "edit:py", isError: false },
  { fp: "bash:python3 exploit_*.py", isError: true },
  { fp: "read:py", isError: false },
  { fp: "edit:py", isError: false },
  { fp: "bash:python3 exploit_*.py", isError: false }, // ← succeeds
]
// Only 2 failures out of 3 occurrences → no trigger
```

**Fingerprint computation** normalizes volatile parts of arguments:

| Tool           | Fingerprint                         | Normalization                                                                  |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `bash`         | `bash:<normalized-command>`         | Strip numbers, collapse paths: `python3 exploit_2.py` → `python3 exploit_*.py` |
| `sandbox_exec` | `sandbox_exec:<normalized-command>` | Same as bash                                                                   |
| `read`         | `read:<extension>`                  | Group by file type: `read /tmp/flag.txt` → `read:txt`                          |
| `write`        | `write:<extension>`                 | Same as read                                                                   |
| `edit`         | `edit:<extension>`                  | Same as read                                                                   |

**Threshold: ≥4 occurrences of the same fingerprint in a window of 8, all with `isError=true`.**

Why this threshold:

- Running `python3 exploit.py` 3 times, all failing: still debugging, might find the bug on the 4th run
- Running it 4+ times, all failing: the script itself is wrong, not a transient bug
- One success anywhere in the window breaks the pattern: the model is making progress

**Cooldown: 30 seconds between signals.** Prevents signal spam during a single stuck episode.

#### Signal 2: Consecutive Failure on Target

The same target (file path, URL, hostname) fails consecutively across different commands.

```typescript
// Per-target failure counter
failureStreaks: { "/api/login": 1, "/api/users": 3 }
// "/api/users" failed 3 times in a row with different commands → trigger
```

The target is extracted from tool arguments:

- `bash`/`sandbox_exec`: target = first meaningful argument (URL, file path, hostname)
- `read`/`write`/`edit`: target = file path
- Other tools: target = tool name

Success on a target resets its streak.

**Threshold: 3 consecutive failures on the same target.**

Why this threshold:

- 1 failure: Expected (probing, trying paths)
- 2 failures: Might be a transient issue or wrong assumption
- 3+ failures: The approach to this target is definitively wrong

### Detection State Machine

```typescript
class StuckDetector {
  // Signal 1: Failed command repetition
  private window: Array<{ fp: string; isError: boolean }> = []
  private readonly WINDOW_SIZE = 8
  private readonly FP_THRESHOLD = 4

  // Signal 2: Consecutive failure on target
  private failureStreaks: Map<string, number> = new Map()
  private readonly STREAK_THRESHOLD = 3

  // Cooldown
  private lastSignalTime = 0
  private readonly COOLDOWN_MS = 30_000

  check(toolName: string, args: Record<string, unknown>, isError: boolean): boolean {
    if (!this.cooldownOk()) return false

    const fp = computeFingerprint(toolName, args)
    const target = getTarget(toolName, args)

    // Maintain sliding window
    this.window.push({ fp, isError })
    if (this.window.length > this.WINDOW_SIZE) this.window.shift()

    // Signal 1: Same fingerprint, all failures in window
    const matching = this.window.filter((e) => e.fp === fp)
    if (matching.length >= this.FP_THRESHOLD && matching.every((e) => e.isError)) {
      return true
    }

    // Signal 2: Consecutive failure streak on target
    if (isError) {
      const streak = (this.failureStreaks.get(target) ?? 0) + 1
      this.failureStreaks.set(target, streak)
      if (streak >= this.STREAK_THRESHOLD) return true
    } else {
      this.failureStreaks.delete(target)
    }

    return false
  }

  private cooldownOk(): boolean {
    const now = Date.now()
    if (now - this.lastSignalTime < this.COOLDOWN_MS) return false
    this.lastSignalTime = now
    return true
  }
}
```

### Why Only Two Signals

Adding more signals increases false positive risk. These two signals cover the most common stuck patterns:

| Stuck pattern                                | Detected by | Not triggered by                                        |
| -------------------------------------------- | ----------- | ------------------------------------------------------- |
| Debugging a broken script (run/fail/fix/run) | Signal 1    | Running, fixing, running again (success breaks pattern) |
| Trying wrong paths/endpoints                 | Signal 2    | Probing 2 different paths (streak resets on success)    |
| Fuzzing with variations                      | Signal 1    | Successful findings break the pattern                   |
| Heavy reverse engineering                    | Neither     | Different targets, different commands, mixed success    |

### Recovery: Self-Steer with Reflection

When any trigger fires, the Solver injects a reflection prompt into itself via `steer()`:

```typescript
private selfRecover(): void {
  const summary = this.summarizeRecentContext();

  this.innerAgent.steer(
    `Your recent approach seems unproductive.\n\n` +
    `Summary of recent steps:\n${summary}\n\n` +
    `Stop. Reflect:\n` +
    `1. What have you actually learned from the results?\n` +
    `2. What assumption might be wrong?\n` +
    `3. What haven't you tried?\n\n` +
    `State your new plan before executing.`
  );
}
```

#### Cheap Context Summary

The summary embedded in the reflection prompt is generated from recent messages using string extraction — no LLM call needed:

```typescript
private summarizeRecentContext(): string {
  const recent = this.state.messages.slice(-8); // Last ~4 turns
  const lines: string[] = [];

  for (const msg of recent) {
    if (msg.role === "assistant") {
      const text = extractAssistantText(msg).slice(0, 200);
      const tools = extractToolCalls(msg);
      if (text) lines.push(`Thought: ${text}`);
      for (const t of tools) lines.push(`Tried: ${t.name}(${formatArgs(t.arguments)})`);
    }
    if (msg.role === "toolResult") {
      lines.push(`Result: ${extractText(msg).slice(0, 100)}`);
    }
  }

  return lines.slice(-10).join("\n");
}
```

Token cost: **zero** (string slicing from existing messages). The summary is ~500 characters. The full reflection prompt is ~600 characters.

### Wiring in Solver

```typescript
class Solver extends FeaturedAgent {
  private detector = new StuckDetector();

  constructor(options: SolverOptions) {
    super({ ... });

    // Per-tool-call: detection via afterToolCall hook
    this.innerAgent.setAfterToolCall(async (ctx) => {
      if (this.detector.check(ctx.toolCall.name, ctx.args, ctx.isError)) {
        this.selfRecover();
      }
      return undefined;
    });
  }
}
```

### What Self-Recovery Is NOT

- **Not compaction**: The Solver's messages are not truncated or summarized. The full context remains. The reflection prompt is additive.
- **Not a Coordinator intervention**: The Coordinator is never involved. It doesn't see detection signals or recovery actions.
- **Not a system prompt change**: The reflection prompt is a user-role message (via `steer`), not a modification of the system prompt. The Solver's persona and instructions remain unchanged.
- **Not guaranteed to work**: The model might ignore the reflection prompt or continue the same approach. If it does, the detector fires again after cooldown, and another reflection prompt is injected. Eventually, repeated reflection prompts will shift the model's attention, or the Solver will exhaust its attempts and report failure.

### Token Budget

| Component                        | Token cost | Frequency                        |
| -------------------------------- | ---------- | -------------------------------- |
| Detection (fingerprint, streak)  | **0**      | Every tool call                  |
| Context summary (string slicing) | **0**      | On trigger only                  |
| Reflection prompt                | **~150**   | On trigger only (max ~1 per 30s) |
| **Total per stuck event**        | **~150**   | —                                |

Compared to the naive approach of the Coordinator reading all events: **~50,000 tokens saved per stuck event.**

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

| Aspect  | Solver                      | Coordinator                    |
| ------- | --------------------------- | ------------------------------ |
| Persona | Expert CTF player           | Team manager                   |
| Tools   | All base + sandbox + docker | Read-only + bash + requestrepo |
| Goal    | Find flags                  | Assign, supervise, submit      |
| Sandbox | Direct access               | No direct access               |
| Browser | Not typically needed        | Uses agent-browser skill       |
