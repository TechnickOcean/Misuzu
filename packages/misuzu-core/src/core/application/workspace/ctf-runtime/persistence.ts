import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { Logger } from "../../../infrastructure/logging/types.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import {
  CTF_RUNTIME_STATE_VERSION,
  type PersistedCTFRuntimeSnapshot,
  type PersistedCTFRuntimeState,
  type PersistedCTFRuntimeWorkspaceState,
} from "./state.ts"

const CTF_RUNTIME_STATE_DIR = "runtime"
const CTF_RUNTIME_STATE_FILE = "ctf-runtime-state.json"

export class CTFRuntimePersistence {
  private stateFilePath = ""
  private state: PersistedCTFRuntimeWorkspaceState | null = null
  private initialized = false

  constructor(private logger: Logger) {}

  get isInitialized() {
    return this.initialized
  }

  async initialize(workspaceRootDir: string) {
    const paths = resolveWorkspacePaths(workspaceRootDir)
    const runtimeDir = join(paths.markerDir, CTF_RUNTIME_STATE_DIR)
    this.stateFilePath = join(runtimeDir, CTF_RUNTIME_STATE_FILE)

    await fs.mkdir(runtimeDir, { recursive: true })
    this.state = await this.loadFromDisk()
    this.initialized = true
  }

  hasState() {
    this.ensureInitialized()
    return this.state !== null
  }

  getState() {
    this.ensureInitialized()
    return this.state
  }

  async saveState(input: {
    runtimeState?: PersistedCTFRuntimeState
    runtime?: PersistedCTFRuntimeSnapshot
  }) {
    this.ensureInitialized()

    const state: PersistedCTFRuntimeWorkspaceState = {
      version: CTF_RUNTIME_STATE_VERSION,
      lastModified: new Date().toISOString(),
      runtimeState: input.runtimeState,
      runtime: input.runtime,
    }

    this.state = state
    await this.saveToDisk(state)
  }

  async saveRuntimeState(runtimeState: PersistedCTFRuntimeState) {
    await this.saveState({
      runtimeState,
      runtime: this.state?.runtime,
    })
  }

  async saveStructuredRuntimeState(runtime: PersistedCTFRuntimeSnapshot) {
    await this.saveState({
      runtime,
      runtimeState: this.state?.runtimeState,
    })
  }

  async clear() {
    this.ensureInitialized()
    this.state = null

    try {
      await fs.unlink(this.stateFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }

  private ensureInitialized() {
    if (!this.initialized) {
      throw new Error("CTFRuntimePersistence not initialized")
    }
  }

  private async loadFromDisk() {
    if (!this.stateFilePath) {
      return null
    }

    try {
      const raw = await fs.readFile(this.stateFilePath, "utf-8")
      const state = JSON.parse(raw) as PersistedCTFRuntimeWorkspaceState
      if (state.version !== CTF_RUNTIME_STATE_VERSION) {
        this.logger.warn("State version mismatch", {
          expected: CTF_RUNTIME_STATE_VERSION,
          actual: state.version,
        })
      }
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }

      this.logger.warn("Failed to load runtime state", error)
      return null
    }
  }

  private async saveToDisk(state: PersistedCTFRuntimeWorkspaceState) {
    await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf-8")
  }
}
