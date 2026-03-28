import "./styles.css"

interface WorkspaceListItem {
  id: string
  name: string
  path: string
  createdAt?: string
  updatedAt?: string
  solverCount: number
}

interface SessionStats {
  lineCount: number
  messageCount: number
  parseErrorCount: number
  toolCalls: Record<string, number>
  roleCounts: Record<string, number>
  totalTokens: number
}

interface SolverSummary {
  solverId: string
  challengeName?: string
  category?: string
  status: string
  model?: string
  updatedAt?: string
  lastAgentEndReason?: string
  lastAgentEndAt?: string
  latestSubmittedFlag?: string
  lastRejectedFlag?: string
  details?: string
  writeupLines: number
  scriptFileCount: number
  attachmentFileCount: number
  session: SessionStats
}

interface WorkspaceSummary {
  generatedAt: string
  workspace: {
    id: string
    name: string
    path: string
    createdAt?: string
    updatedAt?: string
  }
  coordinator: {
    stateUpdatedAt?: string
    queueSize: number
    modelSlots: {
      total: number
      busy: number
      idle: number
      byModel: Array<{ model: string; total: number; busy: number; idle: number }>
    }
    challengeQueue: Array<{
      challengeId?: string
      challengeName?: string
      category?: string
      difficulty?: number
      description?: string
    }>
    session: SessionStats
  }
  solvers: SolverSummary[]
  aggregates: {
    solverCount: number
    queueSize: number
    submittedFlagCount: number
    rejectedFlagCount: number
    totalMessages: number
    totalToolCalls: number
    totalTokens: number
    totalCost: number
    statusCounts: Record<string, number>
    categoryCounts: Record<string, number>
    modelCounts: Record<string, number>
    topTools: Array<{ name: string; count: number }>
    timeline: Array<{ bucket: string; count: number }>
  }
}

interface WorkspaceListResponse {
  ok: boolean
  workspaces: WorkspaceListItem[]
  defaultPath: string
  error?: string
}

interface WorkspaceSummaryResponse {
  ok: boolean
  summary?: WorkspaceSummary
  error?: string
}

interface WorkspaceFileEntry {
  relativePath: string
  name: string
  parentPath: string
  kind: "file" | "directory" | "symlink"
  size: number
  updatedAt: string
  extension: string
  depth: number
  tags: string[]
}

interface WorkspaceFilesResponse {
  ok: boolean
  workspacePath: string
  index: {
    totalFiles: number
    totalDirectories: number
    totalSymlinks: number
    totalBytes: number
    extensionCounts: Array<{ name: string; count: number }>
    tagCounts: Array<{ name: string; count: number }>
    largestFiles: Array<{ relativePath: string; size: number }>
  }
  entries: WorkspaceFileEntry[]
  error?: string
}

interface SessionLinePreview {
  lineNumber: number
  timestamp?: string
  entryType: string
  role?: string
  toolName?: string
  model?: string
  stopReason?: string
  preview: string
  parseError?: string
  rawLine?: string
  contentTypes?: string[]
  toolCalls?: string[]
  textSnippets?: string[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

interface FileContentBase {
  path: string
  kind: string
  size: number
  updatedAt: string
  extension: string
  tags: string[]
}

interface DirectoryFileContent extends FileContentBase {
  view: {
    type: "directory"
    children: Array<{ name: string; kind: string }>
  }
}

interface TextFileContent extends FileContentBase {
  view: {
    type: "text" | "markdown" | "json"
    offset: number
    limit: number
    totalLines: number
    hasMore: boolean
    lines: string[]
  }
}

interface JsonlFileContent extends FileContentBase {
  view: {
    type: "jsonl"
    offset: number
    limit: number
    totalLines: number
    hasMore: boolean
    records: Array<{
      lineNumber: number
      ok: boolean
      preview: string
    }>
  }
}

interface SessionJsonlFileContent extends FileContentBase {
  view: {
    type: "session_jsonl"
    offset: number
    limit: number
    totalLines: number
    hasMore: boolean
    records: SessionLinePreview[]
    stats: {
      parseErrorCount: number
      entryTypeCounts: Record<string, number>
      roleCounts: Record<string, number>
      toolCounts: Record<string, number>
      modelCounts: Record<string, number>
    }
  }
}

interface BinaryFileContent extends FileContentBase {
  view: {
    type: "binary"
    bytesRead: number
    hexPreview: string
  }
}

interface UnsupportedFileContent extends FileContentBase {
  view: {
    type: "unsupported"
    message: string
  }
}

type WorkspaceFileContent =
  | DirectoryFileContent
  | TextFileContent
  | JsonlFileContent
  | SessionJsonlFileContent
  | BinaryFileContent
  | UnsupportedFileContent

interface WorkspaceFileResponse {
  ok: boolean
  workspacePath: string
  content?: WorkspaceFileContent
  error?: string
}

type ActiveView = { kind: "coordinator" } | { kind: "solver"; solverId: string }

const app = document.querySelector<HTMLDivElement>("#app")
if (!app) {
  throw new Error("Missing #app container")
}

const numberFormat = new Intl.NumberFormat("zh-CN")
const moneyFormat = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

app.innerHTML = `
  <div class="dashboard-shell">
    <header class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Misuzu Conversation Studio</p>
        <h1>Coordinator / Solver 对话可视化</h1>
        <p class="subtitle">默认进入 coordinator 聊天记录，图表作为辅助；点击左侧 solver 可切换到对应 solver 的聊天与工作区文件视图。</p>
      </div>
      <div class="hero-meta" id="metaPanel"></div>
    </header>

    <section class="controls card">
      <label>
        工作区列表
        <select id="workspaceSelect"></select>
      </label>
      <label>
        自定义路径
        <input id="workspacePath" type="text" placeholder="E:\\dev\\...\\workspace-id" />
      </label>
      <button id="reloadButton">刷新工作区</button>
      <div class="status" id="statusLine"></div>
    </section>

    <section class="workspace-grid">
      <aside class="card sidebar" id="solverSidebar"></aside>

      <main class="main-column">
        <article class="card chat-panel" id="chatPanel"></article>
        <article class="card files-panel" id="filesPanel"></article>
      </main>

      <aside class="analytics-column">
        <article class="card panel" id="metricsPanel"></article>
        <article class="card panel" id="chartsPanel"></article>
        <article class="card panel" id="queuePanel"></article>
      </aside>
    </section>
  </div>
`

const workspaceSelect = document.querySelector<HTMLSelectElement>("#workspaceSelect")!
const workspacePathInput = document.querySelector<HTMLInputElement>("#workspacePath")!
const reloadButton = document.querySelector<HTMLButtonElement>("#reloadButton")!
const statusLine = document.querySelector<HTMLDivElement>("#statusLine")!
const metaPanel = document.querySelector<HTMLDivElement>("#metaPanel")!
const solverSidebar = document.querySelector<HTMLDivElement>("#solverSidebar")!
const chatPanel = document.querySelector<HTMLDivElement>("#chatPanel")!
const filesPanel = document.querySelector<HTMLDivElement>("#filesPanel")!
const metricsPanel = document.querySelector<HTMLDivElement>("#metricsPanel")!
const chartsPanel = document.querySelector<HTMLDivElement>("#chartsPanel")!
const queuePanel = document.querySelector<HTMLDivElement>("#queuePanel")!

let availableWorkspaces: WorkspaceListItem[] = []
let currentWorkspacePath = ""
let currentSummary: WorkspaceSummary | undefined
let currentFileEntries: WorkspaceFileEntry[] = []

let activeView: ActiveView = { kind: "coordinator" }
let chatContent: SessionJsonlFileContent | undefined
let chatError: string | undefined
let fileContent: WorkspaceFileContent | undefined
let fileError: string | undefined

let fileSearchKeyword = ""
let fileTagFilter = "all"

const chatOffsets = new Map<string, number>()
const selectedFiles = new Map<string, string>()
const fileOffsets = new Map<string, number>()

let viewRequestToken = 0

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function setStatus(text: string, tone: "neutral" | "error" | "ok" = "neutral"): void {
  statusLine.textContent = text
  statusLine.dataset.tone = tone
}

function formatCount(value: number): string {
  return numberFormat.format(value)
}

function formatMoney(value: number): string {
  if (value <= 0) return "0.00"
  return moneyFormat.format(value)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(value?: string): string {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "-"
  return parsed.toLocaleString("zh-CN", { hour12: false })
}

function sortEntries(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function truncate(value: string, maxLength = 180): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "")
}

function joinRelativePath(base: string, child: string): string {
  const normalizedBase = normalizeRelativePath(base)
  const normalizedChild = normalizeRelativePath(child)
  if (!normalizedBase) return normalizedChild
  return `${normalizedBase}/${normalizedChild}`
}

function getViewKey(view: ActiveView): string {
  return view.kind === "coordinator" ? "coordinator" : `solver:${view.solverId}`
}

function getViewTitle(view: ActiveView): string {
  if (view.kind === "coordinator") {
    return "Coordinator"
  }
  return `Solver ${view.solverId}`
}

function getSessionPathForView(view: ActiveView): string {
  if (view.kind === "coordinator") {
    return "coordinator/session.jsonl"
  }
  return `coordinator/solvers/${view.solverId}/session.jsonl`
}

function getScopedEntriesForView(view: ActiveView): WorkspaceFileEntry[] {
  if (view.kind === "coordinator") {
    return currentFileEntries
  }

  const prefix = `coordinator/solvers/${view.solverId}/`.toLowerCase()
  return currentFileEntries.filter((entry) => entry.relativePath.toLowerCase().startsWith(prefix))
}

function getSelectedFileForView(view: ActiveView): string {
  const viewKey = getViewKey(view)
  return selectedFiles.get(viewKey) ?? ""
}

function chooseDefaultFileForView(view: ActiveView, entries: WorkspaceFileEntry[]): string {
  const files = entries.filter((entry) => entry.kind === "file")

  const preferredPatterns =
    view.kind === "coordinator"
      ? ["coordinator/session.jsonl", "coordinator/state.json", "manifest.json"]
      : [
          `coordinator/solvers/${view.solverId}/session.jsonl`,
          `coordinator/solvers/${view.solverId}/writeups.md`,
          `coordinator/solvers/${view.solverId}/environment.md`,
          `coordinator/solvers/${view.solverId}/state.json`,
          `coordinator/solvers/${view.solverId}/scripts/`,
        ]

  for (const pattern of preferredPatterns) {
    const matched = files.find((entry) => entry.relativePath.toLowerCase().includes(pattern))
    if (matched) return matched.relativePath
  }

  return files[0]?.relativePath ?? entries[0]?.relativePath ?? ""
}

function renderMetaPanel(): void {
  if (!currentSummary) {
    metaPanel.innerHTML = '<p class="empty">尚未加载工作区。</p>'
    return
  }

  metaPanel.innerHTML = `
    <div><span>Workspace</span><strong>${escapeHtml(currentSummary.workspace.id)}</strong></div>
    <div><span>当前视图</span><strong>${escapeHtml(getViewTitle(activeView))}</strong></div>
    <div><span>更新时间</span><strong>${escapeHtml(formatDate(currentSummary.workspace.updatedAt))}</strong></div>
    <div><span>统计生成</span><strong>${escapeHtml(formatDate(currentSummary.generatedAt))}</strong></div>
  `
}

function getStatusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes("solved")) return "ok"
  if (normalized.includes("failed") || normalized.includes("error")) return "bad"
  if (normalized.includes("solving") || normalized.includes("running")) return "warn"
  return "neutral"
}

function renderSolverSidebar(): void {
  if (!currentSummary) {
    solverSidebar.innerHTML = '<h3>Solver 导航</h3><p class="empty">等待数据加载...</p>'
    return
  }

  const coordinatorActive = activeView.kind === "coordinator"
  const solverRows = currentSummary.solvers
    .map((solver) => {
      const active = activeView.kind === "solver" && activeView.solverId === solver.solverId
      return `
        <button class="solver-item ${active ? "is-active" : ""}" data-view="solver" data-solver-id="${escapeHtml(solver.solverId)}">
          <div class="solver-item-top">
            <strong>Solver ${escapeHtml(solver.solverId)}</strong>
            <span class="status-${getStatusClass(solver.status)}">${escapeHtml(solver.status)}</span>
          </div>
          <div class="solver-item-mid">${escapeHtml(solver.challengeName ?? "未命名题目")} · ${escapeHtml(solver.category ?? "unknown")}</div>
          <div class="solver-item-meta">
            <span>${escapeHtml(solver.model ?? "-")}</span>
            <span>msg ${formatCount(solver.session.messageCount)}</span>
          </div>
        </button>
      `
    })
    .join("")

  solverSidebar.innerHTML = `
    <h3>Solver 导航</h3>
    <button class="solver-item coordinator-item ${coordinatorActive ? "is-active" : ""}" data-view="coordinator">
      <div class="solver-item-top">
        <strong>Coordinator</strong>
        <span class="status-neutral">主控</span>
      </div>
      <div class="solver-item-mid">总消息 ${formatCount(currentSummary.coordinator.session.messageCount)} · 队列 ${formatCount(currentSummary.coordinator.queueSize)}</div>
    </button>
    <div class="solver-list">${solverRows}</div>
  `
}

function renderBars(title: string, entries: Array<[string, number]>, emptyText: string): string {
  if (entries.length === 0) {
    return `<h3>${escapeHtml(title)}</h3><p class="empty">${escapeHtml(emptyText)}</p>`
  }

  const max = Math.max(...entries.map(([, value]) => value), 1)
  const rows = entries
    .map(([name, value]) => {
      const width = Math.max(6, Math.round((value / max) * 100))
      return `
        <li>
          <div class="bar-label"><span>${escapeHtml(name)}</span><strong>${formatCount(value)}</strong></div>
          <div class="bar-track"><span style="width:${width}%"></span></div>
        </li>
      `
    })
    .join("")

  return `<h3>${escapeHtml(title)}</h3><ul class="bar-list">${rows}</ul>`
}

function renderAnalyticsPanels(): void {
  if (!currentSummary) {
    metricsPanel.innerHTML = '<p class="empty">暂无统计数据。</p>'
    chartsPanel.innerHTML = ""
    queuePanel.innerHTML = ""
    return
  }

  metricsPanel.innerHTML = `
    <h3>辅助指标</h3>
    <div class="mini-metrics">
      <div><span>Solver</span><strong>${formatCount(currentSummary.aggregates.solverCount)}</strong></div>
      <div><span>Queue</span><strong>${formatCount(currentSummary.aggregates.queueSize)}</strong></div>
      <div><span>Messages</span><strong>${formatCount(currentSummary.aggregates.totalMessages)}</strong></div>
      <div><span>ToolCalls</span><strong>${formatCount(currentSummary.aggregates.totalToolCalls)}</strong></div>
      <div><span>Tokens</span><strong>${formatCount(currentSummary.aggregates.totalTokens)}</strong></div>
      <div><span>Cost</span><strong>$${formatMoney(currentSummary.aggregates.totalCost)}</strong></div>
    </div>
  `

  const statusBars = renderBars(
    "Solver 状态",
    sortEntries(currentSummary.aggregates.statusCounts),
    "暂无状态",
  )
  const toolBars = renderBars(
    "工具调用 Top",
    currentSummary.aggregates.topTools.slice(0, 8).map((item) => [item.name, item.count]),
    "暂无工具调用",
  )
  chartsPanel.innerHTML = `${statusBars}<div class="chart-divider"></div>${toolBars}`

  const queueRows = currentSummary.coordinator.challengeQueue
    .slice(0, 10)
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.challengeId ?? "-")}</td>
        <td>${escapeHtml(item.challengeName ?? "-")}</td>
        <td>${escapeHtml(item.category ?? "-")}</td>
      </tr>
    `,
    )
    .join("")

  queuePanel.innerHTML = `
    <h3>待解队列（辅助）</h3>
    ${
      queueRows
        ? `<div class="table-wrap compact"><table><thead><tr><th>ID</th><th>题目</th><th>分类</th></tr></thead><tbody>${queueRows}</tbody></table></div>`
        : '<p class="empty">当前队列为空。</p>'
    }
  `
}

function renderChatPager(view: SessionJsonlFileContent["view"]): string {
  const start = view.totalLines === 0 ? 0 : view.offset + 1
  const end = Math.min(view.offset + view.limit, view.totalLines)
  const canPrev = view.offset > 0
  const canNext = view.hasMore
  return `
    <div class="chat-pager">
      <span>行 ${formatCount(start)} - ${formatCount(end)} / ${formatCount(view.totalLines)}</span>
      <div>
        <button data-chat-page="prev" ${canPrev ? "" : "disabled"}>上一页</button>
        <button data-chat-page="next" ${canNext ? "" : "disabled"}>下一页</button>
      </div>
    </div>
  `
}

interface ChatDisplayItem {
  kind: "message" | "tool"
  timestamp?: string
  role?: string
  model?: string
  preview: string
  snippets: string[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  badges: string[]
  toolName?: string
  callPreview?: string
  resultPreview?: string
}

function buildChatDisplayItems(records: SessionLinePreview[]): ChatDisplayItem[] {
  const items: ChatDisplayItem[] = []
  const pendingCalls: SessionLinePreview[] = []

  for (const record of records) {
    const hasToolCall = (record.toolCalls?.length ?? 0) > 0

    if (record.role === "assistant" && hasToolCall) {
      pendingCalls.push(record)
      continue
    }

    if (record.role === "toolResult") {
      const targetTool = record.toolName
      let callIndex = -1

      if (targetTool) {
        callIndex = pendingCalls.findIndex((candidate) =>
          (candidate.toolCalls ?? []).includes(targetTool),
        )
      }

      const pairedCall =
        callIndex >= 0
          ? pendingCalls.splice(callIndex, 1)[0]
          : pendingCalls.length > 0
            ? pendingCalls.shift()
            : undefined

      items.push({
        kind: "tool",
        timestamp: record.timestamp ?? pairedCall?.timestamp,
        model: pairedCall?.model ?? record.model,
        preview: `${pairedCall ? "tool call + result" : "tool result"}`,
        snippets: [...(pairedCall?.textSnippets ?? []), ...(record.textSnippets ?? [])],
        usage: pairedCall?.usage,
        badges: [
          targetTool ? `tool=${targetTool}` : "tool=unknown",
          record.stopReason ? `stop=${record.stopReason}` : "",
        ].filter(Boolean),
        toolName: targetTool ?? pairedCall?.toolCalls?.[0] ?? pairedCall?.toolName,
        callPreview: pairedCall?.preview,
        resultPreview: record.preview,
      })
      continue
    }

    items.push({
      kind: "message",
      timestamp: record.timestamp,
      role: record.role,
      model: record.model,
      preview: record.preview,
      snippets: record.textSnippets ?? [],
      usage: record.usage,
      badges: [
        `entry=${record.entryType}`,
        record.role ? `role=${record.role}` : "",
        record.stopReason ? `stop=${record.stopReason}` : "",
      ].filter(Boolean),
    })
  }

  for (const pending of pendingCalls) {
    items.push({
      kind: "tool",
      timestamp: pending.timestamp,
      model: pending.model,
      preview: "tool call",
      snippets: pending.textSnippets ?? [],
      usage: pending.usage,
      badges: [
        pending.toolCalls && pending.toolCalls.length > 0
          ? `tool=${pending.toolCalls.join(",")}`
          : "tool=unknown",
      ],
      toolName: pending.toolCalls?.[0] ?? pending.toolName,
      callPreview: pending.preview,
    })
  }

  return items
}

function renderChatPanel(): void {
  const sessionPath = getSessionPathForView(activeView)
  const viewTitle = getViewTitle(activeView)

  if (chatError) {
    chatPanel.innerHTML = `<h2>${escapeHtml(viewTitle)} 聊天记录</h2><p class="empty">${escapeHtml(chatError)}</p>`
    return
  }

  if (!chatContent || chatContent.view.type !== "session_jsonl") {
    chatPanel.innerHTML = `<h2>${escapeHtml(viewTitle)} 聊天记录</h2><p class="empty">暂无 session.jsonl 数据：${escapeHtml(sessionPath)}</p>`
    return
  }

  const view = chatContent.view
  const roleSummary = sortEntries(view.stats.roleCounts)
    .slice(0, 4)
    .map(([name, count]) => `${name}:${formatCount(count)}`)
    .join(" | ")
  const toolSummary = sortEntries(view.stats.toolCounts)
    .slice(0, 4)
    .map(([name, count]) => `${name}:${formatCount(count)}`)
    .join(" | ")

  const displayItems = buildChatDisplayItems(view.records)

  const recordsHtml = displayItems
    .map((item) => {
      const roleClass =
        item.kind === "tool"
          ? "role-tool"
          : `role-${(item.role ?? "unknown").toLowerCase().replace(/[^a-z0-9]/g, "-")}`
      const snippets = item.snippets
        .map((text) => `<pre class="snippet">${escapeHtml(text)}</pre>`)
        .join("")
      const badges = item.badges.join(" | ")

      const usage =
        item.usage && (item.usage.totalTokens > 0 || item.usage.inputTokens > 0)
          ? `<p class="usage-line">tokens: in ${formatCount(item.usage.inputTokens)} / out ${formatCount(item.usage.outputTokens)} / total ${formatCount(item.usage.totalTokens)}</p>`
          : ""

      if (item.kind === "tool") {
        return `
          <article class="chat-record ${roleClass}">
            <header>
              <strong>Tool ${escapeHtml(item.toolName ?? "unknown")}</strong>
              <span>${escapeHtml(formatDate(item.timestamp))}</span>
              <span>${escapeHtml(item.model ?? "-")}</span>
            </header>
            <p class="record-badges">${escapeHtml(badges || "-")}</p>
            ${item.callPreview ? `<p class="record-preview"><span class="call-tag">call</span> ${escapeHtml(item.callPreview)}</p>` : ""}
            ${item.resultPreview ? `<p class="record-preview"><span class="result-tag">result</span> ${escapeHtml(item.resultPreview)}</p>` : ""}
            ${usage}
            ${snippets}
          </article>
        `
      }

      return `
        <article class="chat-record ${roleClass}">
          <header>
            <strong>${escapeHtml(item.role ?? "message")}</strong>
            <span>${escapeHtml(formatDate(item.timestamp))}</span>
            <span>${escapeHtml(item.model ?? "-")}</span>
          </header>
          <p class="record-badges">${escapeHtml(badges || "-")}</p>
          <p class="record-preview">${escapeHtml(item.preview)}</p>
          ${usage}
          ${snippets}
        </article>
      `
    })
    .join("")

  chatPanel.innerHTML = `
    <div class="chat-head">
      <h2>${escapeHtml(viewTitle)} 聊天记录</h2>
      <p class="caption">${escapeHtml(chatContent.path)}</p>
      ${renderChatPager(view)}
      <p class="caption">parse_error=${formatCount(view.stats.parseErrorCount)} | ${escapeHtml(roleSummary)} | ${escapeHtml(toolSummary)}</p>
    </div>
    <div class="chat-records">${recordsHtml || '<p class="empty">当前窗口无记录。</p>'}</div>
  `
}

function renderFilePager(
  offset: number,
  limit: number,
  totalLines: number,
  hasMore: boolean,
): string {
  const start = totalLines === 0 ? 0 : offset + 1
  const end = Math.min(offset + limit, totalLines)
  const canPrev = offset > 0
  const canNext = hasMore
  return `
    <div class="file-pager">
      <span>行 ${formatCount(start)} - ${formatCount(end)} / ${formatCount(totalLines)}</span>
      <div>
        <button data-file-page="prev" ${canPrev ? "" : "disabled"}>上一页</button>
        <button data-file-page="next" ${canNext ? "" : "disabled"}>下一页</button>
      </div>
    </div>
  `
}

function renderFileView(content: WorkspaceFileContent): string {
  switch (content.view.type) {
    case "directory": {
      const children = content.view.children
        .map((child) => {
          const nextPath = joinRelativePath(content.path, child.name)
          return `<button class="file-child" data-open-child="${escapeHtml(nextPath)}"><span>${escapeHtml(child.kind)}</span><strong>${escapeHtml(child.name)}</strong></button>`
        })
        .join("")

      return `<div class="file-child-list">${children || '<p class="empty">空目录。</p>'}</div>`
    }

    case "text":
    case "markdown":
    case "json": {
      const textView = content.view
      const lines = textView.lines
        .map((line, index) => {
          const lineNo = textView.offset + index + 1
          return `<span><em>${formatCount(lineNo)}</em>${escapeHtml(line)}</span>`
        })
        .join("\n")

      return `${renderFilePager(textView.offset, textView.limit, textView.totalLines, textView.hasMore)}<pre class="code-view">${lines || "(empty)"}</pre>`
    }

    case "jsonl": {
      const jsonlView = content.view
      const rows = jsonlView.records
        .map(
          (record) => `
          <tr>
            <td>${formatCount(record.lineNumber)}</td>
            <td>${record.ok ? "ok" : "parse_error"}</td>
            <td>${escapeHtml(record.preview)}</td>
          </tr>
        `,
        )
        .join("")

      return `${renderFilePager(jsonlView.offset, jsonlView.limit, jsonlView.totalLines, jsonlView.hasMore)}<div class="table-wrap compact"><table><thead><tr><th>Line</th><th>Status</th><th>Preview</th></tr></thead><tbody>${rows || '<tr><td colspan="3">(empty)</td></tr>'}</tbody></table></div>`
    }

    case "session_jsonl": {
      const sessionView = content.view
      const rows = sessionView.records
        .map(
          (record) => `
          <tr>
            <td>${formatCount(record.lineNumber)}</td>
            <td>${escapeHtml(record.entryType)}</td>
            <td>${escapeHtml(record.role ?? "-")}</td>
            <td>${escapeHtml(truncate(record.preview, 120))}</td>
          </tr>
        `,
        )
        .join("")

      return `${renderFilePager(sessionView.offset, sessionView.limit, sessionView.totalLines, sessionView.hasMore)}<div class="table-wrap compact"><table><thead><tr><th>Line</th><th>EntryType</th><th>Role</th><th>Preview</th></tr></thead><tbody>${rows || '<tr><td colspan="4">(empty)</td></tr>'}</tbody></table></div>`
    }

    case "binary": {
      return `<p class="caption">二进制预览（前 ${formatCount(content.view.bytesRead)} bytes）</p><pre class="code-view">${escapeHtml(content.view.hexPreview)}</pre>`
    }

    case "unsupported": {
      return `<p class="empty">${escapeHtml(content.view.message)}</p>`
    }

    default:
      return '<p class="empty">暂不支持该文件类型。</p>'
  }
}

function renderFilesPanel(): void {
  const scopedEntries = getScopedEntriesForView(activeView)
  const query = fileSearchKeyword.trim().toLowerCase()

  let filtered = scopedEntries
  if (fileTagFilter !== "all") {
    filtered = filtered.filter((entry) => entry.tags.includes(fileTagFilter))
  }

  if (query.length > 0) {
    filtered = filtered.filter((entry) => {
      const text = `${entry.relativePath} ${entry.tags.join(" ")}`.toLowerCase()
      return text.includes(query)
    })
  }

  const rows = filtered
    .slice(0, 2000)
    .map((entry) => {
      const selected = getSelectedFileForView(activeView) === entry.relativePath
      const indent = Math.min(entry.depth, 8) * 12
      return `
        <button class="file-row ${selected ? "is-selected" : ""}" data-file-path="${escapeHtml(entry.relativePath)}" style="padding-left:${indent + 10}px">
          <span class="file-icon">${escapeHtml(entry.kind === "directory" ? "dir" : entry.kind === "symlink" ? "link" : "file")}</span>
          <span class="file-path">${escapeHtml(entry.relativePath)}</span>
          <span class="file-meta">${entry.kind === "file" ? escapeHtml(formatBytes(entry.size)) : entry.kind}</span>
        </button>
      `
    })
    .join("")

  const activeFile = getSelectedFileForView(activeView)

  const fileHeader = `
    <div class="files-head">
      <h3>${escapeHtml(getViewTitle(activeView))} 工作区文件</h3>
      <p class="caption">scope=${escapeHtml(getViewKey(activeView))} | entries=${formatCount(scopedEntries.length)}</p>
      <div class="file-filter-row">
        <input id="fileSearchInput" type="text" placeholder="搜索文件路径" value="${escapeHtml(fileSearchKeyword)}" />
        <select id="fileTagFilterSelect">
          <option value="all" ${fileTagFilter === "all" ? "selected" : ""}>全部标签</option>
          <option value="session" ${fileTagFilter === "session" ? "selected" : ""}>session</option>
          <option value="writeup" ${fileTagFilter === "writeup" ? "selected" : ""}>writeup</option>
          <option value="script" ${fileTagFilter === "script" ? "selected" : ""}>script</option>
          <option value="attachment" ${fileTagFilter === "attachment" ? "selected" : ""}>attachment</option>
          <option value="state" ${fileTagFilter === "state" ? "selected" : ""}>state</option>
          <option value="markdown" ${fileTagFilter === "markdown" ? "selected" : ""}>markdown</option>
        </select>
        <button id="resetFileFilterButton">重置筛选</button>
      </div>
    </div>
  `

  const fileList = `
    <div class="file-list">
      <div class="file-list-header">
        <h4>文件列表</h4>
        <p class="caption">匹配 ${formatCount(filtered.length)} 条</p>
      </div>
      <div class="file-list-rows">
        ${rows || '<p class="empty">当前筛选无结果。</p>'}
      </div>
    </div>
  `

  const viewerHeader = fileContent
    ? `<h4>${escapeHtml(fileContent.path)}</h4><p class="caption">kind=${escapeHtml(fileContent.kind)} | ext=${escapeHtml(fileContent.extension)} | size=${escapeHtml(formatBytes(fileContent.size))} | updated=${escapeHtml(formatDate(fileContent.updatedAt))}</p>`
    : `<h4>${escapeHtml(activeFile || "未选择文件")}</h4>`

  const viewerBody = fileError
    ? `<p class="empty">${escapeHtml(fileError)}</p>`
    : fileContent
      ? renderFileView(fileContent)
      : '<p class="empty">请选择文件查看内容。</p>'

  filesPanel.innerHTML = `
    ${fileHeader}
    <div class="files-layout">
      ${fileList}
      <div class="file-view">
        <div class="file-view-head">${viewerHeader}</div>
        <div class="file-view-body">${viewerBody}</div>
      </div>
    </div>
  `

  const searchInput = filesPanel.querySelector<HTMLInputElement>("#fileSearchInput")
  const tagSelect = filesPanel.querySelector<HTMLSelectElement>("#fileTagFilterSelect")
  const resetButton = filesPanel.querySelector<HTMLButtonElement>("#resetFileFilterButton")

  searchInput?.addEventListener("input", () => {
    fileSearchKeyword = searchInput.value
    renderFilesPanel()
  })

  tagSelect?.addEventListener("change", () => {
    fileTagFilter = tagSelect.value
    renderFilesPanel()
  })

  resetButton?.addEventListener("click", () => {
    fileSearchKeyword = ""
    fileTagFilter = "all"
    renderFilesPanel()
  })
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

async function loadWorkspaceList(): Promise<void> {
  const data = await fetchJson<WorkspaceListResponse>("/api/workspaces")
  if (!data.ok) {
    throw new Error(data.error ?? "无法加载工作区列表")
  }

  availableWorkspaces = data.workspaces
  workspaceSelect.innerHTML = availableWorkspaces
    .map(
      (item) =>
        `<option value="${escapeHtml(item.path)}">${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`,
    )
    .join("")

  const params = new URLSearchParams(window.location.search)
  const preferred = params.get("workspace") ?? data.defaultPath
  workspacePathInput.value = preferred

  const matched = availableWorkspaces.find((item) => item.path === preferred)
  if (matched) {
    workspaceSelect.value = matched.path
  }
}

async function loadWorkspaceSummary(pathValue: string): Promise<void> {
  const query = new URLSearchParams({ path: pathValue }).toString()
  const data = await fetchJson<WorkspaceSummaryResponse>(`/api/workspace-summary?${query}`)
  if (!data.ok || !data.summary) {
    throw new Error(data.error ?? "无法生成 workspace 摘要")
  }
  currentSummary = data.summary
}

async function loadWorkspaceFiles(pathValue: string): Promise<void> {
  const query = new URLSearchParams({ path: pathValue }).toString()
  const data = await fetchJson<WorkspaceFilesResponse>(`/api/workspace-files?${query}`)
  if (!data.ok) {
    throw new Error(data.error ?? "无法加载 workspace 文件索引")
  }

  currentFileEntries = data.entries
}

async function loadSessionContent(view: ActiveView, token: number): Promise<void> {
  const viewKey = getViewKey(view)
  const offset = chatOffsets.get(viewKey) ?? 0
  const sessionPath = getSessionPathForView(view)

  const query = new URLSearchParams({
    path: currentWorkspacePath,
    file: sessionPath,
    offset: String(offset),
    sessionLimit: "120",
  }).toString()

  try {
    const data = await fetchJson<WorkspaceFileResponse>(`/api/workspace-file?${query}`)
    if (token !== viewRequestToken) return
    if (!data.ok || !data.content) {
      chatError = data.error ?? "读取聊天记录失败"
      chatContent = undefined
      return
    }

    const sessionContent = data.content
    if (sessionContent.view.type !== "session_jsonl") {
      chatError = `文件不是 session_jsonl: ${sessionPath}`
      chatContent = undefined
      return
    }

    chatError = undefined
    chatContent = sessionContent as SessionJsonlFileContent
  } catch (error) {
    if (token !== viewRequestToken) return
    chatError = error instanceof Error ? error.message : "加载聊天记录失败"
    chatContent = undefined
  }
}

async function loadFileContentForView(view: ActiveView, token: number): Promise<void> {
  const scopedEntries = getScopedEntriesForView(view)
  const viewKey = getViewKey(view)
  let selectedPath = selectedFiles.get(viewKey)

  if (!selectedPath || !scopedEntries.some((entry) => entry.relativePath === selectedPath)) {
    selectedPath = chooseDefaultFileForView(view, scopedEntries)
    if (selectedPath) {
      selectedFiles.set(viewKey, selectedPath)
    }
    fileOffsets.set(viewKey, 0)
  }

  if (!selectedPath) {
    fileError = "当前视图没有可浏览文件"
    fileContent = undefined
    return
  }

  const offset = fileOffsets.get(viewKey) ?? 0
  const query = new URLSearchParams({
    path: currentWorkspacePath,
    file: selectedPath,
    offset: String(offset),
    limit: "220",
    sessionLimit: "160",
  }).toString()

  try {
    const data = await fetchJson<WorkspaceFileResponse>(`/api/workspace-file?${query}`)
    if (token !== viewRequestToken) return
    if (!data.ok || !data.content) {
      fileError = data.error ?? "读取文件失败"
      fileContent = undefined
      return
    }

    fileError = undefined
    fileContent = data.content
  } catch (error) {
    if (token !== viewRequestToken) return
    fileError = error instanceof Error ? error.message : "读取文件失败"
    fileContent = undefined
  }
}

function renderAll(): void {
  renderMetaPanel()
  renderSolverSidebar()
  renderChatPanel()
  renderFilesPanel()
  renderAnalyticsPanels()
}

async function enterView(view: ActiveView): Promise<void> {
  activeView = view
  viewRequestToken += 1
  const token = viewRequestToken

  await Promise.all([loadSessionContent(view, token), loadFileContentForView(view, token)])
  if (token !== viewRequestToken) return
  renderAll()
}

async function reloadWorkspace(pathValue: string): Promise<void> {
  currentWorkspacePath = pathValue
  setStatus("正在加载 workspace 数据...")

  await Promise.all([loadWorkspaceSummary(pathValue), loadWorkspaceFiles(pathValue)])

  const currentSolverId = activeView.kind === "solver" ? activeView.solverId : undefined
  if (
    currentSolverId &&
    !currentSummary?.solvers.some((solver) => solver.solverId === currentSolverId)
  ) {
    activeView = { kind: "coordinator" }
  }

  await enterView(activeView)
  setStatus("工作区加载完成", "ok")

  const params = new URLSearchParams(window.location.search)
  params.set("workspace", pathValue)
  history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`)
}

workspaceSelect.addEventListener("change", () => {
  workspacePathInput.value = workspaceSelect.value
  void reloadWorkspace(workspaceSelect.value).catch((error) => {
    const message = error instanceof Error ? error.message : "未知错误"
    setStatus(`加载失败：${message}`, "error")
  })
})

reloadButton.addEventListener("click", () => {
  const pathValue = workspacePathInput.value.trim()
  if (!pathValue) {
    setStatus("请输入 workspace 路径", "error")
    return
  }

  void reloadWorkspace(pathValue).catch((error) => {
    const message = error instanceof Error ? error.message : "未知错误"
    setStatus(`刷新失败：${message}`, "error")
  })
})

solverSidebar.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const trigger = target.closest<HTMLElement>("[data-view]")
  if (!trigger) return

  const view = trigger.dataset.view
  if (view === "coordinator") {
    void enterView({ kind: "coordinator" }).catch((error) => {
      const message = error instanceof Error ? error.message : "未知错误"
      setStatus(`切换失败：${message}`, "error")
    })
    return
  }

  if (view === "solver") {
    const solverId = trigger.dataset.solverId
    if (!solverId) return
    void enterView({ kind: "solver", solverId }).catch((error) => {
      const message = error instanceof Error ? error.message : "未知错误"
      setStatus(`切换失败：${message}`, "error")
    })
  }
})

chatPanel.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const actionEl = target.closest<HTMLElement>("[data-chat-page]")
  if (!actionEl || !chatContent || chatContent.view.type !== "session_jsonl") return

  const action = actionEl.dataset.chatPage
  const currentOffset = chatContent.view.offset
  const limit = chatContent.view.limit
  const viewKey = getViewKey(activeView)

  let nextOffset = currentOffset
  if (action === "prev") {
    nextOffset = Math.max(0, currentOffset - limit)
  } else if (action === "next") {
    nextOffset = currentOffset + limit
  }

  if (nextOffset === currentOffset) return

  chatOffsets.set(viewKey, nextOffset)
  void enterView(activeView).catch((error) => {
    const message = error instanceof Error ? error.message : "未知错误"
    setStatus(`翻页失败：${message}`, "error")
  })
})

filesPanel.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const fileRow = target.closest<HTMLElement>("[data-file-path]")
  if (fileRow?.dataset.filePath) {
    const viewKey = getViewKey(activeView)
    selectedFiles.set(viewKey, fileRow.dataset.filePath)
    fileOffsets.set(viewKey, 0)
    void enterView(activeView).catch((error) => {
      const message = error instanceof Error ? error.message : "未知错误"
      setStatus(`打开文件失败：${message}`, "error")
    })
    return
  }

  const openChild = target.closest<HTMLElement>("[data-open-child]")
  if (openChild?.dataset.openChild) {
    const viewKey = getViewKey(activeView)
    selectedFiles.set(viewKey, openChild.dataset.openChild)
    fileOffsets.set(viewKey, 0)
    void enterView(activeView).catch((error) => {
      const message = error instanceof Error ? error.message : "未知错误"
      setStatus(`打开子文件失败：${message}`, "error")
    })
    return
  }

  const pager = target.closest<HTMLElement>("[data-file-page]")
  if (!pager || !fileContent) return

  const action = pager.dataset.filePage
  const viewKey = getViewKey(activeView)

  if (
    fileContent.view.type !== "text" &&
    fileContent.view.type !== "markdown" &&
    fileContent.view.type !== "json" &&
    fileContent.view.type !== "jsonl" &&
    fileContent.view.type !== "session_jsonl"
  ) {
    return
  }

  const currentOffset = fileContent.view.offset
  const limit = fileContent.view.limit
  let nextOffset = currentOffset

  if (action === "prev") {
    nextOffset = Math.max(0, currentOffset - limit)
  } else if (action === "next") {
    nextOffset = currentOffset + limit
  }

  if (nextOffset === currentOffset) return

  fileOffsets.set(viewKey, nextOffset)
  void enterView(activeView).catch((error) => {
    const message = error instanceof Error ? error.message : "未知错误"
    setStatus(`文件翻页失败：${message}`, "error")
  })
})

void (async () => {
  try {
    await loadWorkspaceList()
    const initialPath = workspacePathInput.value.trim()
    if (!initialPath) {
      setStatus("未找到可分析的 workspace", "error")
      return
    }

    await reloadWorkspace(initialPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败"
    setStatus(`初始化失败：${message}`, "error")
  }
})()
