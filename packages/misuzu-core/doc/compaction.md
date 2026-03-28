# Compaction

Compaction keeps long-running agent sessions usable by summarizing older message history.

## Scope

- Compaction operates on `AgentMessage[]` only
- It does not mutate `systemPrompt`
- Skill catalog remains intact because skills live in `systemPrompt`, not in message history

## Trigger Rule

Compaction is considered when:

- estimated context tokens > `model.contextWindow - reserveTokens`

Current constants:

- `reserveTokens = 16384`
- `keepRecentTokens = 20000`

## Token Estimation Strategy

- Uses heuristic (`chars / 4`) for generic messages
- Prefers latest assistant usage metadata when available, then adds heuristic for trailing messages

## Cut Strategy

- Keep recent portion of the conversation
- Summarize older portion into one `compactionSummary` message
- Avoid cutting at `toolResult` boundaries to preserve turn coherence

## Summary Generation

- Summarization is delegated to model inference (`completeSimple`)
- Previous `compactionSummary` (if present) is merged into the new summary
- Result shape after compaction:
  - `[compactionSummary, ...keptRecentMessages]`

## Custom Message Handling

Custom messages (`flagResult`, `challengeUpdate`, `compactionSummary`) are serialized into summary input text so important state transitions are not lost.

## Integration Point

`FeaturedAgent` attaches compaction via `transformContext`.

Behavior:

- if `checkCompact(agent)` is false -> keep original messages
- if true -> call `compact(agent)` and use returned message list

## Public API

Exported functions:

- `checkCompact(agent)`
- `compact(agent)`
- `compactWithSummary(messages, summary)`
- `estimateTokens(message)`
- `estimateContextTokens(messages)`
- `findCutPoint(messages)`

## Caller Notes

- Treat compaction as lossy by design; it preserves intent/progress, not raw transcript fidelity
- Use persistence (`session.jsonl`, state files) for audit-grade detail
- Keep critical instructions in `systemPrompt` or durable files rather than ephemeral chat turns
