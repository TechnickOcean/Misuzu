# Compaction

LLM context windows are finite. When CTF solving sessions grow too long, misuzu uses compaction to summarize older messages while preserving recent work. Compaction is implemented as pure functions operating on `AgentMessage[]`, invoked through the `transformContext` hook in `pi-agent-core`.

## Table of Contents

- [Overview](#overview)
- [When It Triggers](#when-it-triggers)
- [Token Estimation](#token-estimation)
- [Cut Point Detection](#cut-point-detection)
- [Summarization](#summarization)
- [Custom Message Handling](#custom-message-handling)
- [Skill Catalog Protection](#skill-catalog-protection)
- [Integration](#integration)

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  AgentState.systemPrompt (persona + skills catalog)         │  ← Unchanged
├─────────────────────────────────────────────────────────────┤
│  AgentState.messages                                        │
│  ┌────────┬────────┬──────┬──────┬────────┬──────┬───────┐  │
│  │  usr   │  ass   │ tool │ tool │  usr   │  ass │ tool  │  │
│  └────────┴────────┴──────┴──────┴────────┴──────┴───────┘  │
│               │                          └───────┬────────┘ │
│               │                              kept (30%)     │
│               ▼                                           │
│         compacted (70%)                                    │
│               │                                           │
│               ▼                                           │
│  ┌──────────────┬────────┬──────┬──────┬────────┬──────┬───────┐
│  │ compactSummary │  usr   │  ass │ tool │  usr   │  ass │ tool  │
│  └──────────────┴────────┴──────┴──────┴────────┴──────┴───────┘
└─────────────────────────────────────────────────────────────┘
```

All functions are pure: they take messages in, return messages out. No side effects.

## When It Triggers

Compaction triggers when estimated context tokens exceed the available window:

```
contextTokens > contextWindow - reserveTokens
```

**Default settings:**

| Setting            | Value  | Description                            |
| ------------------ | ------ | -------------------------------------- |
| `reserveTokens`    | 16,384 | Tokens reserved for the LLM's response |
| `keepRecentTokens` | 20,000 | Target tokens to keep un-compacted     |

The check runs in the `transformContext` hook, called by `pi-agent-core` before every LLM call:

```typescript
// In FeaturedAgent constructor:
this.agent = new Agent({
  transformContext: async (messages, signal) => {
    if (checkCompact(this.agent)) {
      return compact(this.agent)
    }
    return messages
  },
})
```

## Token Estimation

Token counts are estimated using a `chars / 4` heuristic. This is conservative (overestimates tokens).

```typescript
export function estimateTokens(message: AgentMessage): number {
  switch (message.role) {
    case "user": {
      // String content: content.length / 4
      // Array content: sum of text block lengths / 4
    }
    case "assistant": {
      // Sum of text, thinking, and toolCall (name + JSON args) chars / 4
    }
    case "toolResult": {
      // Content text chars / 4, images counted as 4800 chars
    }
    case "compactionSummary": {
      // summary.length / 4
    }
  }
  return 0
}
```

### Using Actual Usage Data

When available, actual token counts from `AssistantMessage.usage` are preferred over estimates:

```typescript
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    // No usage data: fall back to estimateTokens for all messages
    return { tokens: messages.reduce((sum, m) => sum + estimateTokens(m), 0), ... };
  }

  // Use actual usage for messages up to last assistant, estimate trailing
  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens };
}
```

## Cut Point Detection

The cut point is where the message array is split: everything before is summarized, everything after is kept.

### Algorithm

1. Identify **valid cut points**: indices of `user` or `assistant` messages
2. **Never** cut at `toolResult` messages (they must stay with their tool call)
3. Walk backwards from the newest message, accumulating estimated tokens
4. When accumulated tokens reach `keepRecentTokens`, snap to the nearest valid cut point

```
Messages (walked right-to-left):

  index:  0     1     2      3     4      5      6     7
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬──────┐
        │ usr │ ass │ tool│ tool │ ass │ tool │ usr  │ ass  │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴──────┘
          ◄─ 70% (summarize) ─►◄──── 30% (keep) ────────────►
                                              ↑
                                     cut point (index 6)
                                     valid: it's a user message
```

### Split Turns

When a single turn exceeds `keepRecentTokens`, the cut lands mid-turn at an assistant message:

```
  index:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ usr │ ass │ tool│ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
          ↑                                            ↑
   turnStartIndex = 1                        cut point (index 7)
                                             valid: assistant message
```

For split turns, two summaries are generated:

1. **History summary**: All complete turns before the split
2. **Turn prefix summary**: The early part of the split turn (index 1–6)

These are merged into a single summary.

### Cut Point Rules

| Message type        | Valid cut point? | Reason                            |
| ------------------- | ---------------- | --------------------------------- |
| `user`              | Yes              | Starts a new turn                 |
| `assistant`         | Yes              | Ends a turn (tool results follow) |
| `toolResult`        | No               | Must stay with its tool call      |
| `custom`            | Yes              | Treated like a user message       |
| `compactionSummary` | Yes              | Previous compaction result        |

## Summarization

After finding the cut point, the LLM generates a structured summary of the messages being compacted.

### Summary Format

```
## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [Any constraints mentioned]
- Or "(none)"

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data, paths, references needed to continue]
```

### Iterative Updates

If a previous compaction summary exists, the summarization prompt merges new information:

```
The messages above are NEW conversation messages to incorporate into the
existing summary provided in <previous-summary> tags.

Update the existing structured summary:
- PRESERVE all existing information
- ADD new progress, decisions, and context
- UPDATE Progress: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
```

### Message Serialization for Summarization

Messages are serialized to text before summarization, so the LLM treats them as data to summarize (not a conversation to continue):

```typescript
function serializeConversation(messages: Message[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    if (msg.role === "user") {
      parts.push(`[User]: ${extractText(msg.content)}`)
    } else if (msg.role === "assistant") {
      // Separate thinking, text, and tool calls
      parts.push(`[Assistant]: ${textParts.join("\n")}`)
      parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`)
    } else if (msg.role === "toolResult") {
      // Truncate tool results to 2000 chars for summarization
      parts.push(`[Tool result]: ${truncateForSummary(content, 2000)}`)
    }
  }

  return parts.join("\n\n")
}
```

Tool results are truncated to 2,000 characters during summarization. Full content is not needed to generate a useful summary.

## Custom Message Handling

Misuzu defines custom message types for CTF operations via declaration merging:

```typescript
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    challengeUpdate: ChallengeUpdateMessage
    flagResult: FlagResultMessage
  }
}
```

These are converted to `user` messages by `convertToLlm` before the LLM call:

```typescript
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m) => {
    switch (m.role) {
      case "challengeUpdate":
        return [
          {
            role: "user",
            content: `[Challenge ${m.challengeId}: ${m.status}] ${m.details}`,
            timestamp: m.timestamp,
          },
        ]
      case "flagResult":
        return [
          {
            role: "user",
            content: `[Flag ${m.correct ? "CORRECT" : "WRONG"}] ${m.message}`,
            timestamp: m.timestamp,
          },
        ]
      case "user":
      case "assistant":
      case "toolResult":
        return [m]
      default:
        return []
    }
  })
}
```

Custom messages that should not appear in LLM context (e.g., UI-only messages) return an empty array and are filtered out.

### Compaction and Custom Messages

During compaction, custom messages are included in the messages-to-summarize. The `convertToLlm` function converts them to user messages before the summarization LLM call. The `estimateTokens` function handles custom message types:

```typescript
case "challengeUpdate":
case "flagResult":
  chars = message.details.length;
  return Math.ceil(chars / 4);
```

## Skill Catalog Protection

The skill catalog is **inherently protected** from compaction because of where it lives:

```
┌─────────────────────────────────────────────┐
│  AgentState.systemPrompt                    │  ← NOT part of messages
│                                             │
│  You are a CTF solver...                    │
│                                             │
│  <available_skills>                         │  ← Skill catalog
│    <skill>                                  │
│      <name>playwright-cli</name>            │
│      <description>Browser automation...</desc│
│      <location>/path/to/SKILL.md</location> │
│    </skill>                                 │
│  </available_skills>                        │
│                                             │
├─────────────────────────────────────────────┤
│  AgentState.messages                        │  ← Compaction operates here
│  [user, assistant, toolResult, ...]         │
└─────────────────────────────────────────────┘
```

**Why it's safe:**

1. `systemPrompt` is a separate field on `AgentState`, passed to the LLM as a distinct parameter on every call
2. `transformContext` (where compaction runs) only receives and returns `AgentMessage[]` — it has no access to `systemPrompt`
3. After compaction, the summary is a `compactionSummary` custom message, converted to a user message by `convertToLlm`. The system prompt (with skills) remains unchanged alongside it

**What would be dangerous:** Placing skill definitions as messages in the conversation. This would make them vulnerable to compaction. Misuzu avoids this by design — skills always go in the system prompt.

See [skills.md](skills.md) for how the catalog is built and [architecture.md](architecture.md) for the layer diagram.

## Integration

### In FeaturedAgent

```typescript
export class FeaturedAgent {
  constructor(options: FeaturedAgentOptions) {
    const skillCatalog = buildSkillsCatalog(skills)

    this.agent = new Agent({
      initialState: {
        systemPrompt: basePrompt + skillCatalog, // Skills in system prompt
        tools: createBaseTools(cwd),
      },
      convertToLlm, // Custom message conversion
      transformContext: async (messages, signal) => {
        if (checkCompact(this.agent)) {
          return compact(this.agent) // Only touches messages
        }
        return messages
      },
    })
  }
}
```

### Pure Functions API

```typescript
import {
  checkCompact,
  compact,
  estimateTokens,
  estimateContextTokens,
  findCutPoint,
} from "./features/compaction"

// Check if compaction is needed
if (checkCompact(agent)) {
  // Run compaction, get new message array
  const compactedMessages = await compact(agent)
  agent.replaceMessages(compactedMessages)
}

// Estimate tokens for a single message
const tokens = estimateTokens(someMessage)

// Estimate total context tokens
const { tokens, usageTokens, trailingTokens } = estimateContextTokens(agent.state.messages)
```
