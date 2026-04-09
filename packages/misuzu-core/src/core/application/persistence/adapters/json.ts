import { promises as fs } from "fs"
import path from "path"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Logger } from "../../../infrastructure/logging/types.ts"
import type {
  PersistedSolverAgentState,
  PersistedWorkspaceState,
  PersistenceStore,
  WorkspaceChange,
} from "../store.ts"

const STATE_VERSION = "1.0.0"
const STATE_FILE_NAME = "workspace-state.json"
const STATE_DIR = "state"
const MESSAGES_DIR = "messages"
const MESSAGES_PER_FILE = 150

export class JsonFilePersistenceAdapter implements PersistenceStore {
  private rootDir = ""
  private misuzuState: PersistedWorkspaceState | null = null
  private pendingChanges: WorkspaceChange[] = []
  private debounceTimer: NodeJS.Timeout | null = null
  private initialized = false

  constructor(private logger: Logger) {}

  async initialize(workspaceRootDir: string) {
    this.rootDir = workspaceRootDir
    await this.ensureDirectories()

    const existingState = await this.loadStateFile()
    if (existingState) {
      this.misuzuState = existingState
      this.logger.info("Loaded existing workspace state", {
        mainAgentExists: !!existingState.mainAgent,
      })
    }

    this.initialized = true
  }

  async hasPersistedState() {
    if (!this.initialized) {
      throw new Error("PersistenceStore not initialized")
    }
    return this.misuzuState !== null
  }

  async restoreState() {
    if (!this.initialized) {
      throw new Error("PersistenceStore not initialized")
    }

    if (!this.misuzuState) {
      return null
    }

    if (this.misuzuState.mainAgent?.messagesFileRef) {
      try {
        const messages = await this.loadMessagesFromFiles(
          this.misuzuState.mainAgent.messagesFileRef.fileIndices,
        )
        this.misuzuState.mainAgent.agentState.messages = messages
      } catch (error) {
        this.logger.error(
          "Failed to load agent messages",
          JSON.stringify((error as Error)?.message),
        )
        throw error
      }
    }

    return this.misuzuState
  }

  async recordChange(change: WorkspaceChange) {
    if (!this.initialized) {
      throw new Error("PersistenceStore not initialized")
    }

    this.pendingChanges.push(change)

    if (change.type === "state-initialized" || change.type === "main-agent-created") {
      await this.flushImmediate()
      return
    }

    this.debounce()
  }

  getCurrentState() {
    return this.misuzuState
  }

  async flush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    await this.flushImmediate()
  }

  async clear() {
    if (!this.initialized) {
      throw new Error("PersistenceStore not initialized")
    }

    this.misuzuState = null
    this.pendingChanges = []

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    const stateFilePath = path.join(this.rootDir, ".misuzu", STATE_FILE_NAME)
    try {
      await fs.unlink(stateFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    const messagesDir = path.join(this.rootDir, ".misuzu", STATE_DIR, MESSAGES_DIR)
    try {
      const files = await fs.readdir(messagesDir)
      for (const file of files) {
        await fs.unlink(path.join(messagesDir, file))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }

  private debounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.flushImmediate().catch((error) => {
        this.logger.error("Failed to flush changes", JSON.stringify((error as Error)?.message))
      })
    }, 500)
  }

  private async flushImmediate() {
    if (this.pendingChanges.length === 0) {
      return
    }

    const changes = this.pendingChanges
    this.pendingChanges = []

    for (const change of changes) {
      switch (change.type) {
        case "state-initialized":
          this.misuzuState = change.state
          break
        case "providers-loaded":
          if (this.misuzuState) {
            this.misuzuState.proxyProvidersLoaded = true
            this.misuzuState.lastModified = new Date().toISOString()
          }
          break
        case "main-agent-created":
          if (!this.misuzuState) {
            this.misuzuState = {
              version: STATE_VERSION,
              lastModified: new Date().toISOString(),
              proxyProvidersLoaded: false,
            }
          }
          {
            const state = this.misuzuState
            state.mainAgent = change.agentState
            state.lastModified = new Date().toISOString()
          }
          break
        case "agent-message-added":
          if (this.misuzuState?.mainAgent) {
            const messages = this.misuzuState.mainAgent.agentState.messages || []
            messages.push(change.message)
            this.misuzuState.mainAgent.agentState.messages = messages
            this.misuzuState.mainAgent.lastModified = new Date().toISOString()
            this.misuzuState.lastModified = new Date().toISOString()
          }
          break
        case "agent-state-updated":
          if (!this.misuzuState) {
            this.misuzuState = {
              version: STATE_VERSION,
              lastModified: new Date().toISOString(),
              proxyProvidersLoaded: false,
            }
          }
          {
            const state = this.misuzuState
            state.mainAgent = change.agentState
            state.lastModified = new Date().toISOString()
          }
          break
        case "tool-execution":
          // 工具执行不需要额外持久化（已在消息中）
          break
      }
    }

    // 写入到磁盘
    if (this.misuzuState) {
      await this.saveStateFile(this.misuzuState)
    }
  }

  private async ensureDirectories() {
    const dirs = [
      path.join(this.rootDir, ".misuzu"),
      path.join(this.rootDir, ".misuzu", STATE_DIR),
      path.join(this.rootDir, ".misuzu", STATE_DIR, MESSAGES_DIR),
    ]

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error
        }
      }
    }
  }

  private async loadStateFile(): Promise<PersistedWorkspaceState | null> {
    const stateFilePath = path.join(this.rootDir, ".misuzu", STATE_FILE_NAME)

    try {
      const content = await fs.readFile(stateFilePath, "utf-8")
      const state = JSON.parse(content) as PersistedWorkspaceState

      if (state.version !== STATE_VERSION) {
        this.logger.warn("State version mismatch", {
          expected: STATE_VERSION,
          actual: state.version,
        })
      }

      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      this.logger.warn("Failed to load state file", JSON.stringify((error as Error)?.message))
      return null
    }
  }

  private async saveStateFile(state: PersistedWorkspaceState): Promise<void> {
    const stateFilePath = path.join(this.rootDir, ".misuzu", STATE_FILE_NAME)

    // 如果 Agent 消息过多，分片存储
    if (
      state.mainAgent?.agentState.messages &&
      state.mainAgent.agentState.messages.length > MESSAGES_PER_FILE
    ) {
      state.mainAgent = await this.saveMessagesInChunks(state.mainAgent)
    }

    // 序列化时排除消息（如果已分片存储）
    const stateToSave = { ...state }
    if (stateToSave.mainAgent?.messagesFileRef) {
      // 消息会被单独存储，这里不需要包含完整消息
      const agentStateWithoutMessages = { ...stateToSave.mainAgent.agentState }
      agentStateWithoutMessages.messages = []
      stateToSave.mainAgent = {
        ...stateToSave.mainAgent,
        agentState: agentStateWithoutMessages,
      }
    }

    try {
      await fs.writeFile(stateFilePath, JSON.stringify(stateToSave, null, 2), "utf-8")
      this.logger.debug("Saved workspace state")
    } catch (error) {
      this.logger.error("Failed to save state file", JSON.stringify((error as Error)?.message))
      throw error
    }
  }

  private async saveMessagesInChunks(
    agentState: PersistedSolverAgentState,
  ): Promise<PersistedSolverAgentState> {
    const messages = agentState.agentState.messages || []
    if (messages.length === 0) {
      return agentState
    }

    const fileIndices: number[] = []
    const messageCounts: number[] = []

    const messagesDir = path.join(this.rootDir, ".misuzu", STATE_DIR, MESSAGES_DIR)

    for (let i = 0; i < messages.length; i += MESSAGES_PER_FILE) {
      const chunk = messages.slice(i, i + MESSAGES_PER_FILE)
      const fileIndex = fileIndices.length
      const filePath = path.join(messagesDir, `messages-${fileIndex}.json`)

      try {
        await fs.writeFile(filePath, JSON.stringify(chunk, null, 2), "utf-8")
        fileIndices.push(fileIndex)
        messageCounts.push(chunk.length)
      } catch (error) {
        this.logger.error(
          `Failed to save message chunk ${fileIndex}`,
          JSON.stringify((error as Error)?.message),
        )
        throw error
      }
    }

    return {
      ...agentState,
      agentState: {
        ...agentState.agentState,
        messages: [], // 清空消息，使用 fileRef
      },
      messagesFileRef: {
        fileIndices,
        messageCounts,
      },
    }
  }

  private async loadMessagesFromFiles(fileIndices: number[]): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = []
    const messagesDir = path.join(this.rootDir, ".misuzu", STATE_DIR, MESSAGES_DIR)

    for (const fileIndex of fileIndices) {
      const filePath = path.join(messagesDir, `messages-${fileIndex}.json`)

      try {
        const content = await fs.readFile(filePath, "utf-8")
        const chunk = JSON.parse(content) as AgentMessage[]
        messages.push(...chunk)
      } catch (error) {
        this.logger.error(
          `Failed to load message chunk ${fileIndex}`,
          JSON.stringify((error as Error)?.message),
        )
        throw error
      }
    }

    return messages
  }
}
