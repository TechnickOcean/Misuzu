import { promises as fs } from "node:fs"
import { join } from "node:path"
import type { Logger } from "../../../infrastructure/logging/types.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import {
  CTF_RUNTIME_STATE_VERSION,
  type PersistedEnvironmentAgentRuntimeState,
  type PersistedCTFRuntimeSnapshot,
  type PersistedCTFRuntimeState,
  type PersistedCTFRuntimeWorkspaceState,
} from "./state.ts"

const CTF_RUNTIME_STATE_DIR = "runtime"
const CTF_RUNTIME_STATE_FILE = "ctf-runtime-state.json"
const CTF_RUNTIME_STATE_BACKUP_FILE = "ctf-runtime-state.json.bak"
const CTF_RUNTIME_STATE_TEMP_FILE = "ctf-runtime-state.json.tmp"

export class CTFRuntimePersistence {
  private stateFilePath = ""
  private stateBackupFilePath = ""
  private stateTempFilePath = ""
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
    this.stateBackupFilePath = join(runtimeDir, CTF_RUNTIME_STATE_BACKUP_FILE)
    this.stateTempFilePath = join(runtimeDir, CTF_RUNTIME_STATE_TEMP_FILE)

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
    environmentRuntimeState?: PersistedEnvironmentAgentRuntimeState
    runtimeState?: PersistedCTFRuntimeState
    runtime?: PersistedCTFRuntimeSnapshot
  }) {
    this.ensureInitialized()

    const state: PersistedCTFRuntimeWorkspaceState = {
      version: CTF_RUNTIME_STATE_VERSION,
      lastModified: new Date().toISOString(),
      environmentRuntimeState: input.environmentRuntimeState,
      runtimeState: input.runtimeState,
      runtime: input.runtime,
    }

    this.state = state
    await this.saveToDisk(state)
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

    try {
      await fs.unlink(this.stateBackupFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    try {
      await fs.unlink(this.stateTempFilePath)
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
      const state = await this.readStateFile(this.stateFilePath)
      // Keep loading older snapshots so operators can migrate state manually.
      if (state.version !== CTF_RUNTIME_STATE_VERSION) {
        this.logger.warn("State version mismatch", {
          expected: CTF_RUNTIME_STATE_VERSION,
          actual: state.version,
        })
      }
      return state
    } catch (error) {
      const backupState = await this.tryLoadBackupState(error)
      if (backupState) {
        return backupState
      }

      this.logger.warn("Failed to load runtime state", JSON.stringify((error as Error)?.message))
      return null
    }
  }

  private async saveToDisk(state: PersistedCTFRuntimeWorkspaceState) {
    const serialized = JSON.stringify(state, null, 2)
    await fs.writeFile(this.stateTempFilePath, serialized, "utf-8")

    try {
      await fs.copyFile(this.stateFilePath, this.stateBackupFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    try {
      await fs.unlink(this.stateFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    await fs.rename(this.stateTempFilePath, this.stateFilePath)
  }

  private async readStateFile(filePath: string) {
    const raw = await fs.readFile(filePath, "utf-8")
    return JSON.parse(raw) as PersistedCTFRuntimeWorkspaceState
  }

  private async tryLoadBackupState(loadError: unknown) {
    if ((loadError as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }

    try {
      const backup = await this.readStateFile(this.stateBackupFilePath)
      this.logger.warn("Primary runtime state is unreadable, restored from backup", {
        primaryPath: this.stateFilePath,
        backupPath: this.stateBackupFilePath,
      })
      return backup
    } catch (backupError) {
      this.logger.warn(
        "Failed to load runtime state backup",
        JSON.stringify((backupError as Error)?.message),
      )
      return null
    }
  }
}
