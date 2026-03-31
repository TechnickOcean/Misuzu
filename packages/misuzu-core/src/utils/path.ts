import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// bad find-up algo, but idk how2fix it
export function resolveMisuzuRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve(startDir)

  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}
