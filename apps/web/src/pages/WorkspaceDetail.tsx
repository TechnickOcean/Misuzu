import { Activity, BookOpen, ChevronLeft, Flag, Play, Square } from "lucide-react"
import { type SetStateAction, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { AgentEvent, WorkspaceEvent, WorkspaceRecord } from "@/types"

const API_HTTP =
  import.meta.env.VITE_API_HTTP ??
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001")
const API_WS = API_HTTP.replace(/^http/, "ws")

const activityLabels: Record<string, string> = {
  step_start: "开始步骤",
  step_end: "完成步骤",
  tool_call: "调用工具",
  tool_result: "工具返回",
  model_output: "模型输出",
  retry: "请求重试",
  max_steps: "达到上限",
  content_filter: "内容过滤",
  length: "输出过长",
  terminal_output: "终端输出",
  terminal_exit: "终端退出"
}

export default function WorkspaceDetail() {
  const { id } = useParams()
  const workspaceId = Number(id)

  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null)
  const [agentEvents, setAgentEvents] = useState<AgentEvent["data"][]>([])

  const [agentMode, setAgentMode] = useState<"ctf" | "hiro">("ctf")
  const [agentModel, setAgentModel] = useState("glm-4.7-flash")
  const [agentQuestions, setAgentQuestions] = useState("")
  const [isStartingAgent, setIsStartingAgent] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Initial fetch
    fetch(`${API_HTTP}/api/workspaces/${workspaceId}`)
      .then((res) => res.json())
      .then(setWorkspace)
      .catch(() => {})

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
        }
      } catch {
        // ignore
      }
    }
    return () => ws.close()
  }, [workspaceId])

  const isAgentRunning = Boolean(workspace?.is_running)
  const agentStatusLabel = isAgentRunning
    ? "running"
    : (workspace?.agent_state?.status ?? workspace?.store?.status ?? "idle")
  const agentSteps = workspace?.agent_state?.step_count ?? 0
  const progressValue = Math.min(100, Math.max(10, agentSteps * 4))

  async function handleAgentStart() {
    setIsStartingAgent(true)
    const questions = agentQuestions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agentModel,
        type: agentMode,
        questions
      })
    }).catch(() => {})
    setIsStartingAgent(false)
  }

  async function handleAgentStop() {
    await fetch(`${API_HTTP}/api/workspaces/${workspaceId}/agent/stop`, { method: "POST" }).catch(() => {})
  }

  // Filter events for the "Log" view (exclude raw terminal output to avoid clutter, show it in Shell tab maybe?)
  // Actually, let's keep everything in the Log for now, but maybe format terminal output differently.
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
          <Card>
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
                <span className="font-semibold">{workspace?.store?.findings?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <BookOpen className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Knowledge</span>
                </div>
                <span className="font-semibold">{workspace?.store?.knowledge_index?.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-700">
                  <Activity className="h-4 w-4 text-stone-400" />
                  <span className="text-sm">Events</span>
                </div>
                <span className="font-semibold">{agentEvents.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500 uppercase tracking-wider">Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="agent">
                  Mode
                </label>
                <Select value={agentMode} onValueChange={(v) => setAgentMode(v as SetStateAction<"ctf" | "hiro">)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ctf">CTF Solver</SelectItem>
                    <SelectItem value="hiro">AgentHiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="questions">
                  Research Questions
                </label>
                <Textarea
                  className="text-xs min-h-[100px]"
                  placeholder="Instructions for AgentHiro..."
                  value={agentQuestions}
                  onChange={(e) => setAgentQuestions(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <div className="min-h-[500px]">
          <Tabs defaultValue="log" className="h-full flex flex-col">
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
                value="knowledge"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Knowledge
              </TabsTrigger>
              <TabsTrigger
                value="findings"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:shadow-none px-2 py-3"
              >
                Findings / Solutions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="log" className="flex-1 mt-4 overflow-hidden flex flex-col">
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

            <TabsContent value="shell" className="flex-1 mt-4">
              <Card className="h-[600px] bg-black text-green-400 font-mono text-sm p-4 overflow-y-auto">
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

            <TabsContent value="knowledge" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(workspace?.store?.knowledge_index ?? []).map((k, _i) => (
                  <Card>
                    <CardHeader className="p-4">
                      <CardTitle className="text-base">{k.title}</CardTitle>
                      <CardDescription className="text-xs">{k.source}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-sm text-stone-600">{k.summary}</CardContent>
                  </Card>
                ))}
                {!workspace?.store?.knowledge_index?.length && (
                  <p className="text-stone-500">No knowledge indexed yet.</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="findings" className="mt-4">
              <div className="space-y-4">
                {(workspace?.store?.findings ?? []).map((f: unknown, i) => (
                  <Card>
                    <CardHeader className="p-4">
                      <CardTitle className="text-base">Finding #{i + 1}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <pre className="whitespace-pre-wrap text-sm bg-stone-100 p-2 rounded">
                        {JSON.stringify(f, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
                {!workspace?.store?.findings?.length && <p className="text-stone-500">No findings recorded yet.</p>}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
