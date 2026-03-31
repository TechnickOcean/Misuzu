import { statSync } from "node:fs"
import { access } from "node:fs/promises"
import * as os from "node:os"
import { dirname, isAbsolute, join, resolve, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g
const NARROW_NO_BREAK_SPACE = "\u202F"

function normalizeUnicodeSpaces(str: string) {
  return str.replace(UNICODE_SPACES, " ")
}

function tryMacOSScreenshotPath(filePath: string) {
  return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`)
}

function tryNFDVariant(filePath: string) {
  return filePath.normalize("NFD")
}

function tryCurlyQuoteVariant(filePath: string) {
  return filePath.replace(/'/g, "\u2019")
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeAtPrefix(filePath: string) {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath
}

export function expandPath(filePath: string) {
  const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath))
  if (normalized === "~") {
    return os.homedir()
  }

  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1)
  }

  return normalized
}

export function resolveToCwd(filePath: string, cwd: string) {
  const expanded = expandPath(filePath)
  if (isAbsolute(expanded)) {
    return expanded
  }

  return resolvePath(cwd, expanded)
}

export async function resolveReadPath(filePath: string, cwd: string) {
  const resolved = resolveToCwd(filePath, cwd)

  if (await fileExists(resolved)) {
    return resolved
  }

  const amPmVariant = tryMacOSScreenshotPath(resolved)
  if (amPmVariant !== resolved && (await fileExists(amPmVariant))) {
    return amPmVariant
  }

  const nfdVariant = tryNFDVariant(resolved)
  if (nfdVariant !== resolved && (await fileExists(nfdVariant))) {
    return nfdVariant
  }

  const curlyVariant = tryCurlyQuoteVariant(resolved)
  if (curlyVariant !== resolved && (await fileExists(curlyVariant))) {
    return curlyVariant
  }

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant)
  if (nfdCurlyVariant !== resolved && (await fileExists(nfdCurlyVariant))) {
    return nfdCurlyVariant
  }

  return resolved
}

// TODO: bad find-up algo, but idk how2fix it
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
