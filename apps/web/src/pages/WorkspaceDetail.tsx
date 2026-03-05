import { Activity, BookOpen, ChevronLeft, File, FileText, Flag, Folder, Play, RefreshCw, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { AgentEvent, WorkspaceEvent, WorkspaceFile, WorkspaceRecord } from "@/types"

const API_HTTP =
  import.meta.env.VITE_API_HTTP ??
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001")
const API_WS = API_HTTP.replace(/^http/, "ws")

const activityLabels: Record<string, string> = {
  step_start: "Start Step",
  step_end: "End Step",
  tool_call: "Tool Call",
  tool_result: "Tool Result",
  model_output: "Model Output",
  retry: "Retry",
  max_steps: "Max Steps",
  content_filter: "Content Filter",
  length: "Length Limit",
  terminal_output: "Terminal Output",
  terminal_exit: "Terminal Exit"
}

const statusLabels: Record<string, string> = {
  idle: "idle",
  running: "running",
  paused: "paused",
  done: "done",
  max_steps: "max steps",
  filtered: "filtered",
  failed: "failed",
  blocked: "blocked"
}

export default function WorkspaceDetail() {
  const { id } = useParams()
  const workspaceId = id ?? ""

  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null)
  const [agentEvents, setAgentEvents] = useState<AgentEvent["data"][]>([])
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>("")
  const [isLoadingFile, setIsLoadingFile] = useState(false)

  const [agentModel, setAgentModel] = useState("glm-4.7-flash")
  const [isStartingAgent, setIsStartingAgent] = useState(false)

  const [manualPrompt, setManualPrompt] = useState("")
  const [manualFileAction, setManualFileAction] = useState<"file_read" | "file_write" | "file_edit" | "file_delete">(
    "file_read"
  )
  const [manualFilePath, setManualFilePath] = useState("")
  const [manualFileContent, setManualFileContent] = useState("")
  const [manualOldContent, setManualOldContent] = useState("")
  const [manualNewContent, setManualNewContent] = useState("")
  const [manualResult, setManualResult] = useState("")
  const [isManualBusy, setIsManualBusy] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)

  const fetchWorkspace = useCallback(() => {
    fetch(`${API_HTTP}/api/workspaces/${workspaceId}`)
      .then((res) => res.json())
      .then(setWorkspace)
      .catch(() => {})
  }, [workspaceId])

  const fetchFiles = useCallback(() => {
    fetch(`${API_HTTP}/api/workspaces/${workspaceId}/files`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFiles(data)
        }
      })
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    // Initial fetch
    fetchWorkspace()
    fetchFiles()

    // Switch to this workspace on the server to ensure it's "active"
    fetch(`${API_HTTP}/api/workspaces/${workspaceId}/switch`, { method: "POST" }).catch(() => {})

    const ws = new WebSocket(`${API_WS}/ws`)
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WorkspaceEvent | AgentEvent

        // Update workspace data if we receive a broadcast
        if (payload.type === "workspaces") {
          const found = payload.data.find((w) => w.id === workspaceId)
          if (found) setWorkspace(found)
        }

        // Append events for this workspace
        if (payload.type === "agent_event" && payload.workspace_id === workspaceId) {
          setAgentEvents((prev) => [...prev, payload.data].slice(-200)) // Keep last 200 events
          // Refresh files if tool use might have changed them (heuristic)
          if (payload.data.type === "tool_result" || payload.data.type === "step_end") {
            fetchFiles()
          }
        }
      } catch {
        // ignore
      }
    }
    return () => ws.close()
  }, [workspaceId, fetchFiles, fetchWorkspace])

  async function loadFileContent(path: string) {
    setSelectedFile(path)
    setIsLoadingFile(true)
    try {
      const res = await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/files/${path}`)
      if (res.ok) {
        const text = await res.text()
        setFileContent(text)
      } else {
        setFileContent("Error loading file content")
      }
    } catch {
      setFileContent("Error loading file content")
    } finally {
      setIsLoadingFile(false)
    }
  }

  const isAgentRunning = Boolean(workspace?.is_running)
  const rawStatus = isAgentRunning ? "running" : (workspace?.agent_state?.status ?? "idle")
  const agentStatusLabel = statusLabels[rawStatus] ?? rawStatus
  const agentSteps = workspace?.agent_state?.step_count ?? 0
  const progressValue = Math.min(100, Math.max(10, agentSteps * 4))
  const canManual = !isAgentRunning && ["paused", "max_steps", "filtered", "done"].includes(String(rawStatus))

  async function handleAgentStart() {
    setIsStartingAgent(true)
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agentModel,
        type: "ctf",
        questions: []
      })
    }).catch(() => {})
    setIsStartingAgent(false)
  }

  async function handleAgentStop() {
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/stop`, { method: "POST" }).catch(() => {})
  }

  async function handleAgentPause() {
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" })
    }).catch(() => {})
  }

  async function handleDialogueResume() {
    if (!manualPrompt.trim()) return
    setIsManualBusy(true)
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dialogue", prompt: manualPrompt })
    }).catch(() => {})
    setManualPrompt("")
    if (!isAgentRunning) {
      await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: agentModel, type: "ctf", questions: [] })
      }).catch(() => {})
    }
    setIsManualBusy(false)
  }

  async function handleCompactContext() {
    setIsManualBusy(true)
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "compact", model: agentModel })
    }).catch(() => {})
    setIsManualBusy(false)
  }

  async function handleFileAction() {
    if (!manualFilePath.trim()) return
    setIsManualBusy(true)
    setManualResult("")
    const payload: Record<string, unknown> = {
      action: manualFileAction,
      file_path: manualFilePath
    }
    if (manualFileAction === "file_write") payload.content = manualFileContent
    if (manualFileAction === "file_edit") {
      payload.old_content = manualOldContent
      payload.new_content = manualNewContent
    }
    const res = await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => null)
    if (res?.ok && manualFileAction === "file_read") {
      const text = await res.text().catch(() => "")
      setManualResult(text)
    } else if (!res?.ok) {
      setManualResult("Action failed")
    } else {
      setManualResult("Action completed")
    }
    setIsManualBusy(false)
  }

  // Stats calculation
  const findingsCount = files.filter(
    (f) =>
      f.path.toLowerCase().includes("finding") ||
      f.path.toLowerCase().includes("writeup") ||
      f.path.toLowerCase().includes("flag")
  ).length

  const knowledgeCount = files.filter(
    (f) => f.path.toLowerCase().includes("knowledge") || f.path.toLowerCase().includes("note")
  ).length

  const logEvents = agentEvents.slice().reverse()

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon" className="text-stone-500 hover:bg-stone-100 hover:text-stone-900">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-stone-900">{workspace?.title || "Loading..."}</h1>
                <Badge
                  variant={agentStatusLabel === "running" ? "default" : "secondary"}
                  className="rounded-full px-3 capitalize"
                >
                  {agentStatusLabel}
                </Badge>
              </div>
              <p className="text-xs text-stone-500">
                ID: {workspaceId} · Last updated: {workspace?.agent_state?.updated_at ?? "-"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Select value={agentModel} onValueChange={setAgentModel}>
              <SelectTrigger className="w-[180px] h-9 text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="glm-4.7-flash">glm-4.7-flash</SelectItem>
                <SelectItem value="llama-4-scout-17b-16e-instruct">llama-4-scout</SelectItem>
                <SelectItem value="qwen3-30b-a3b-fp8">qwen3-30b</SelectItem>
              </SelectContent>
            </Select>

            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              onClick={handleAgentStart}
              disabled={isAgentRunning || isStartingAgent}
            >
              <Play className="h-3 w-3" /> Start Agent
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-2"
              onClick={handleAgentStop}
              disabled={agentStatusLabel !== "running"}
            >
              <Square className="h-3 w-3" /> Stop
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-6 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Sidebar / Stats */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500 uppercase tracking-wider">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-2">
                <span className="text-3xl font-bold text-stone-800">{agentSteps}</span>
                <span className="text-xs text-stone-500 mb-1">steps executed</span>
              </div>
              <Progress value={progressValue} className="h-2 bg-stone-100" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500 uppercase tracking-wider">Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <Flag className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Findings</span>
                </div>
                <span className="font-semibold">{findingsCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <BookOpen className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Knowledge</span>
                </div>
                <span className="font-semibold">{knowledgeCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <Activity className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Events</span>
                </div>
                <span className="font-semibold">{agentEvents.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <File className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Files</span>
                </div>
                <span className="font-semibold">{files.filter((f) => f.type === "file").length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500 uppercase tracking-wider">
                Manual Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Session</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleAgentPause}
                  disabled={agentStatusLabel === "paused"}
                >
                  Pause
                </Button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="manual-prompt">
                  Dialogue Resume
                </label>
                <Textarea
                  id="manual-prompt"
                  className="text-xs min-h-[80px]"
                  placeholder="Add a user prompt, then resume CTFAgent..."
                  value={manualPrompt}
                  onChange={(e) => setManualPrompt(e.target.value)}
                  disabled={!canManual || isManualBusy}
                />
                <Button
                  size="sm"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleDialogueResume}
                  disabled={!canManual || isManualBusy || !manualPrompt.trim()}
                >
                  Resume with Prompt
                </Button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="compact">
                  Compact Context
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={handleCompactContext}
                  disabled={!canManual || isManualBusy}
                >
                  Compact Now
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <div className="min-h-[640px]">
          <Tabs defaultValue="log" className="h-full flex flex-col min-h-[640px]">
            <TabsList className="w-full justify-start bg-transparent border-b border-stone-200 rounded-none h-auto p-0 gap-6">
              <TabsTrigger
                value="log"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Agent Log
              </TabsTrigger>
              <TabsTrigger
                value="shell"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Shell Output
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Files
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Manual Ops
              </TabsTrigger>
            </TabsList>

            <TabsContent value="log" className="flex-1 mt-4 overflow-hidden data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col overflow-hidden bg-stone-900 border-stone-800 text-stone-300 font-mono text-sm">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {logEvents.length === 0 ? (
                    <div className="text-stone-600 text-center py-10">Waiting for agent activity...</div>
                  ) : (
                    logEvents.map((ev, _i) => (
                      <div className="flex gap-3 border-l-2 border-stone-700 pl-3 py-1">
                        <div className="min-w-[120px] text-stone-500 text-xs shrink-0 pt-0.5">
                          {activityLabels[ev.type] || ev.type}
                        </div>
                        <div className="break-all whitespace-pre-wrap">
                          {/* Specialized rendering for different event types */}
                          {ev.type === "tool_call" && (
                            <>
                              <span className="text-purple-400 font-bold">{String(ev.tool)}</span>
                              <div className="text-stone-500 text-xs mt-1">{JSON.stringify(ev.input)}</div>
                            </>
                          )}
                          {ev.type === "tool_result" && (
                            <div className="text-stone-400 text-xs mt-1 max-h-[100px] overflow-hidden relative">
                              {String(ev.output).substring(0, 300)}...
                            </div>
                          )}
                          {ev.type === "terminal_output" && (
                            <span className="text-cyan-300">
                              {ev.stream === "stderr" ? <span className="text-red-400">STDERR: </span> : ""}
                              {String(ev.chunk)}
                            </span>
                          )}
                          {/* Default fallback */}
                          {!["tool_call", "tool_result", "terminal_output"].includes(ev.type) && (
                            <span>{JSON.stringify(ev)}</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="shell" className="flex-1 mt-4 overflow-hidden data-[state=active]:flex flex-col">
              <Card className="flex-1 bg-black text-green-400 font-mono text-sm p-4 overflow-y-auto">
                <pre>
                  {agentEvents
                    .filter((e) => e.type === "terminal_output")
                    .map((e) => (
                      <span key={Math.random()} className={e.stream === "stderr" ? "text-red-400" : ""}>
                        {String(e.chunk)}
                      </span>
                    ))}
                  {agentEvents.filter((e) => e.type === "terminal_output").length === 0 && (
                    <span className="text-stone-600">No background terminal output recorded in this session.</span>
                  )}
                </pre>
              </Card>
            </TabsContent>

            <TabsContent value="files" className="mt-4 flex-1 data-[state=active]:flex flex-col overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 flex-1 min-h-[560px]">
                <Card className="overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-600 uppercase">Explorer</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchFiles}>
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2">
                    {files.length === 0 && (
                      <div className="text-xs text-stone-500 text-center py-4">No files found</div>
                    )}
                    {files.map((file) => (
                      <button
                        type="button"
                        className={`
                          flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer
                          ${selectedFile === file.path ? "bg-emerald-100 text-emerald-800 font-medium" : "hover:bg-stone-100 text-stone-700"}
                        `}
                        onClick={() => file.type === "file" && loadFileContent(file.path)}
                      >
                        {file.type === "dir" ? (
                          <Folder className="h-4 w-4 text-amber-400 shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-stone-400 shrink-0" />
                        )}
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                  </div>
                </Card>
                <Card className="flex flex-col overflow-hidden bg-white min-h-[560px]">
                  <div className="p-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between h-10">
                    <span className="text-xs font-semibold text-stone-600">
                      {selectedFile || "Select a file to view"}
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto bg-stone-50 p-0 relative min-h-[0]">
                    {isLoadingFile ? (
                      <div className="absolute inset-0 flex items-center justify-center text-stone-400">Loading...</div>
                    ) : selectedFile ? (
                      <pre className="p-4 text-xs font-mono text-stone-800 leading-relaxed whitespace-pre-wrap">
                        {fileContent}
                      </pre>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-stone-400 gap-2">
                        <FileText className="h-8 w-8 opacity-20" />
                        <span className="text-sm">No file selected</span>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 flex-1 overflow-hidden data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-stone-500 uppercase tracking-wider">
                    Context Operations
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3 items-center">
                    <span className="text-xs font-medium">Action</span>
                    <Select
                      value={manualFileAction}
                      onValueChange={(v) => setManualFileAction(v as typeof manualFileAction)}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="file_read">Read</SelectItem>
                        <SelectItem value="file_write">Write</SelectItem>
                        <SelectItem value="file_edit">Edit</SelectItem>
                        <SelectItem value="file_delete">Delete</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3 items-center">
                    <span className="text-xs font-medium">File Path</span>
                    <Input
                      className="text-xs"
                      placeholder="e.g. notes/findings.md"
                      value={manualFilePath}
                      onChange={(e) => setManualFilePath(e.target.value)}
                      disabled={!canManual || isManualBusy}
                    />
                  </div>
                  {manualFileAction === "file_write" && (
                    <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
                      <span className="text-xs font-medium">Content</span>
                      <Textarea
                        className="text-xs min-h-[140px]"
                        value={manualFileContent}
                        onChange={(e) => setManualFileContent(e.target.value)}
                        disabled={!canManual || isManualBusy}
                      />
                    </div>
                  )}
                  {manualFileAction === "file_edit" && (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
                        <span className="text-xs font-medium">Old Content</span>
                        <Textarea
                          className="text-xs min-h-[100px]"
                          value={manualOldContent}
                          onChange={(e) => setManualOldContent(e.target.value)}
                          disabled={!canManual || isManualBusy}
                        />
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-3">
                        <span className="text-xs font-medium">New Content</span>
                        <Textarea
                          className="text-xs min-h-[100px]"
                          value={manualNewContent}
                          onChange={(e) => setManualNewContent(e.target.value)}
                          disabled={!canManual || isManualBusy}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={handleFileAction}
                      disabled={!canManual || isManualBusy || !manualFilePath.trim()}
                    >
                      Run Action
                    </Button>
                    <span className="text-xs text-stone-500">Available when paused/max_steps/filtered/done.</span>
                  </div>
                  <div className="flex-1 border border-stone-200 rounded-md bg-stone-50 p-3 overflow-auto">
                    {manualResult ? (
                      <pre className="text-xs whitespace-pre-wrap text-stone-700">{manualResult}</pre>
                    ) : (
                      <span className="text-xs text-stone-400">No output yet.</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
