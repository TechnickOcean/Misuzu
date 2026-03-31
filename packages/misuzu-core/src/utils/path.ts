import { statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// bad find-up algo, but idk how2fix it
export function resolveMisuzuRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve(startDir)

  while (true) {
    try {
      if (statSync(join(current, "pnpm-workspace.yaml")).isFile()) {
        return current
      }
    } catch {}

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}
