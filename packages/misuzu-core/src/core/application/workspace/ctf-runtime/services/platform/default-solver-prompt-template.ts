export const DEFAULT_SOLVER_PROMPT_TEMPLATE = [
  "You are assigned to challenge [{challenge.id}] {challenge.title}.",
  "Category: {challenge.category}, score: {challenge.score}, solved: {challenge.solvedCount}.",
  "Use platform tools to fetch the detail of challenge.",
  "Use them carefully and avoid unnecessary requests.",
  "Task payload:",
  "{payload}",
].join("\n")
