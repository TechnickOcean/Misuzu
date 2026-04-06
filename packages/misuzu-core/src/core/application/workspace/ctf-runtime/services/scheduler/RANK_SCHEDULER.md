# Runtime Solver Rank Scheduler Design Notes

This document records the rank model, simulation assumptions, and selected parameter values
for runtime challenge orchestration.

## Goals

- Keep dispatch slots saturated while avoiding long-tail starvation.
- Ensure a single challenge does not monopolize a slot for more than ~90 minutes.
- Penalize unstable solvers that repeatedly stop unexpectedly.

## Static Priority (Base Rank)

Challenges are pre-ranked by category and container requirement.

- Category order: `web > re > pwn > other > crypto > misc`
- Container order: `no-container > container`

Base values:

- `web=30`
- `re=24`
- `pwn=20`
- `other=16`
- `crypto=12`
- `misc=8`
- `no-container bonus=+6`

## Dynamic Rank Model

For each challenge, rank is updated with queueing and waiting time:

- Queued/active challenge:
  - `rank = base + enqueueBoost - queueDecayPerMinute * queuedMinutes - stopPenalty * stopBurst`
- Waiting challenge:
  - `rank = base + waitGainPerMinute * waitingMinutes - stopPenalty * stopBurst`

Selected values:

- `enqueueBoost = 12`
- `queueDecayPerMinute = 0.25`
- `waitGainPerMinute = 0.40`
- `stopPenalty = 8`
- `swapMargin = 4`
- `minRunSlice = 12 min`
- `hardCap = 90 min`
- `hardCooldown = 15 min`
- `stopBurstLimit = 5`
- `stopCooldown = 20 min`
- `stopRecoveryWindow = 18 min` (decrease burst by 1 each window)

## Scheduling Rules

- Rebalance loop runs every 15s and also on key events.
- Compute ranked candidates and keep only top-K in queue (`K = min(solverCount, modelPoolCapacity)`).
- If an active challenge exceeds `hardCap`, preempt and cooldown.
- If an active challenge falls below waiting candidates by `swapMargin` and has run at least
  `minRunSlice`, preempt and replace.

## Unexpected Stop Policy

- Non-abort-like unexpected stop increments `stopBurst`.
- After each unexpected stop, solver is auto-recovered by sending `continue()` once.
- If `stopBurst >= 5`, apply cooldown (`20 min`) to reduce rapid re-entry.

## Simulation Record

Monte Carlo simulation was run locally with a simplified model:

- 24 challenges, 4 dispatch slots, minute-level scheduler loop.
- Solve probability increases with base rank.
- Random unexpected stop probability applied to active tasks.

Comparison output (captured from local run):

- Baseline FIFO:
  - `p95 continuous slot occupancy = 240 min`
  - `average max occupancy = 220.92 min`
- Proposed rank scheduler:
  - `p95 continuous slot occupancy = 90 min`
  - `average max occupancy = 85.73 min`

The selected parameters are tuned to satisfy the practical target that one challenge should not
block a solver slot for more than ~90 minutes under sustained load.
