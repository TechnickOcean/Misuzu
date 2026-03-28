#!/usr/bin/env tsx
import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { getModels, type Api, type KnownProvider, type Model } from "@mariozechner/pi-ai"
import { Coordinator, ProxyProvider, defaultWorkspacesRoot } from "misuzu-core"
import { startMisuzuServer } from "./server.ts"
import { MisuzuRuntimeHost } from "./runtime.ts"

interface CliOptions {
  host: string
  port: number
  workspace?: string
  workspaceRoot: string
  ctfPlatformUrl?: string
  models: string[]
  modelConcurrency?: number
  eventBufferSize: number
  sseHeartbeatMs: number
  autoContinueSolvers: boolean
  token?: string
  tokenFile?: string
}

async function main() {
  registerDefaultProxyProviders()
  const options = parseCliOptions(process.argv.slice(2))
  const modelMap = loadModels(options.models)
  const modelResolver = (modelId: string) => modelMap.get(modelId)
  const defaultModel = options.models[0] ? modelMap.get(options.models[0]) : undefined

  const coordinator = options.workspace
    ? Coordinator.resumeFromWorkspace({
        workspaceDir: options.workspace,
        autoContinueSolvers: options.autoContinueSolvers,
        workspaceRoot: options.workspaceRoot,
        ctfPlatformUrl: options.ctfPlatformUrl,
        models: options.models.length > 0 ? options.models : undefined,
        model: defaultModel,
        modelResolver,
      })
    : new Coordinator({
        cwd: options.workspaceRoot,
        workspaceRoot: options.workspaceRoot,
        ctfPlatformUrl: options.ctfPlatformUrl,
        models: options.models.length > 0 ? options.models : undefined,
        modelConcurrency: options.modelConcurrency,
        model: defaultModel,
        modelResolver,
      })

  const poolModelIds = Array.from(new Set(coordinator.modelPool.toJSON().map((slot) => slot.model)))
  for (const modelId of poolModelIds) {
    ensureModelLoaded(modelMap, modelId)
  }

  const workspacesRoot = options.workspace
    ? resolve(dirname(options.workspace))
    : defaultWorkspacesRoot(options.workspaceRoot)

  let requestRestart = () => {}

  const runtime = new MisuzuRuntimeHost(coordinator, {
    workspacesRoot,
    replayLimit: options.eventBufferSize,
    startupEventType: options.workspace ? "runtime.resumed" : "runtime.started",
    ensureModelAvailable: async (modelId) => {
      ensureModelLoaded(modelMap, modelId)
    },
    onServerRestartRequested: async () => {
      setTimeout(() => {
        requestRestart()
      }, 80)
    },
  })

  const { token, tokenPath } = ensureAuthToken(coordinator, options)
  const { server } = startMisuzuServer(runtime, {
    hostname: options.host,
    port: options.port,
    authToken: token,
    sseHeartbeatMs: options.sseHeartbeatMs,
  })

  const manifest = coordinator.persistence.readManifest()
  console.log(`[misuzu-server] listening on http://${options.host}:${options.port}`)
  console.log(`[misuzu-server] workspace: ${manifest.id}`)
  console.log(`[misuzu-server] token file: ${tokenPath}`)
  if (options.models.length > 0) {
    console.log(`[misuzu-server] models: ${options.models.join(", ")}`)
  }

  let shuttingDown = false
  let restarting = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    runtime.close()
    coordinator.persistence.close()
    server.close(() => {
      process.exit(0)
    })
  }

  requestRestart = () => {
    if (restarting || shuttingDown) return

    const result = spawnReplacementProcess()
    if (!result.ok) {
      console.error(`[misuzu-server] restart failed: ${result.message}`)
      return
    }

    restarting = true
    console.log(`[misuzu-server] restart requested: ${result.message}`)
    shutdown()
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

void main().catch((error) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
  console.error(`[misuzu-server] fatal: ${message}`)
  process.exit(1)
})

function parseCliOptions(argv: string[]): CliOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith("--")) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      values.set(key, next)
      index += 1
      continue
    }

    flags.add(key)
  }

  const workspaceRoot = resolve(values.get("workspace-root") ?? process.cwd())
  const workspace = values.get("workspace") ? resolve(values.get("workspace")!) : undefined
  const models = parseModelList(values.get("models") ?? process.env.MISUZU_MODELS)
  const model = values.get("model") ?? process.env.MISUZU_MODEL
  if (model && !models.includes(model)) {
    models.unshift(model)
  }

  return {
    host: values.get("host") ?? process.env.MISUZU_HOST ?? "127.0.0.1",
    port: parseNumber(values.get("port") ?? process.env.MISUZU_PORT, 7788),
    workspace,
    workspaceRoot,
    ctfPlatformUrl: values.get("ctf-platform-url") ?? process.env.MISUZU_CTF_PLATFORM_URL,
    models,
    modelConcurrency: parseOptionalNumber(
      values.get("model-concurrency") ?? process.env.MISUZU_MODEL_CONCURRENCY,
    ),
    eventBufferSize: parseNumber(
      values.get("event-buffer-size") ?? process.env.MISUZU_EVENT_BUFFER_SIZE,
      1000,
    ),
    sseHeartbeatMs: parseNumber(
      values.get("sse-heartbeat-ms") ?? process.env.MISUZU_SSE_HEARTBEAT_MS,
      15000,
    ),
    autoContinueSolvers: !flags.has("no-auto-continue-solvers"),
    token: values.get("token") ?? process.env.MISUZU_SERVER_TOKEN,
    tokenFile: values.get("token-file") ?? process.env.MISUZU_SERVER_TOKEN_FILE,
  }
}

function parseModelList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = parseOptionalNumber(value)
  return typeof parsed === "number" ? parsed : fallback
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function loadModels(modelRefs: string[]): Map<string, Model<Api>> {
  const loaded = new Map<string, Model<Api>>()

  for (const modelRef of modelRefs) {
    const model = loadModel(modelRef)
    loaded.set(modelRef, model)
  }

  return loaded
}

function ensureModelLoaded(modelMap: Map<string, Model<Api>>, modelRef: string): Model<Api> {
  const existing = modelMap.get(modelRef)
  if (existing) return existing

  const loaded = loadModel(modelRef)
  modelMap.set(modelRef, loaded)
  return loaded
}

function spawnReplacementProcess(): { ok: boolean; message: string } {
  const argv = [...process.execArgv, ...process.argv.slice(1)]

  try {
    const child = spawn(process.execPath, argv, {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.unref()

    return {
      ok: true,
      message: `spawned replacement pid ${child.pid ?? "n/a"}`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "spawn failed",
    }
  }
}

function loadModel(modelRef: string): Model<Api> {
  const parts = modelRef.split("/")
  if (parts.length < 2) {
    throw new Error(`invalid model reference: ${modelRef} (expected provider/model-id)`)
  }

  const provider = parts[0] as KnownProvider
  const modelId = parts.slice(1).join("/")
  const available = getModels(provider)
  const found = available.find((model) => model.id === modelId)
  if (found) return found

  throw new Error(
    `unrecognized model ${modelRef}. available for ${provider}: ${available.map((m) => m.id).join(", ")}`,
  )
}

function ensureAuthToken(
  coordinator: Coordinator,
  options: Pick<CliOptions, "token" | "tokenFile" | "workspaceRoot">,
) {
  const manifest = coordinator.persistence.readManifest()
  const tokenFilePath = resolve(
    options.tokenFile ?? join(options.workspaceRoot, ".misuzu", "runtime", manifest.id, "token"),
  )

  mkdirSync(dirname(tokenFilePath), { recursive: true })

  if (options.token && options.token.trim().length > 0) {
    writeFileSync(tokenFilePath, `${options.token.trim()}\n`, { encoding: "utf-8", mode: 0o600 })
    return { token: options.token.trim(), tokenPath: tokenFilePath }
  }

  if (existsSync(tokenFilePath)) {
    const token = readFileSync(tokenFilePath, "utf-8").trim()
    if (token.length > 0) {
      return { token, tokenPath: tokenFilePath }
    }
  }

  const token = randomBytes(24).toString("hex")
  writeFileSync(tokenFilePath, `${token}\n`, { encoding: "utf-8", mode: 0o600 })
  return { token, tokenPath: tokenFilePath }
}

function registerDefaultProxyProviders() {
  const hasRightCodeApiKey = Boolean(process.env.RIGHTCODE_API_KEY)
  if (!hasRightCodeApiKey) return

  new ProxyProvider({
    provider: "rightcode",
    baseProvider: "openai",
    baseUrl: "https://www.right.codes/codex/v1",
    apiKeyEnvVar: "RIGHTCODE_API_KEY",
    modelMappings: [
      "gpt-5.4",
      "gpt-5.3-codex",
      {
        sourceModelId: "gpt-5.2",
        targetModelId: "gpt-5.2-xhigh",
        targetModelName: "GPT-5.2 XHigh",
      },
    ],
  }).register()
}
