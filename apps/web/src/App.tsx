import { useEffect, useMemo, useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type WorkspaceSummary = {
  id: string
  name: string
  status: string
}

type WorkspaceEvent = {
  type: "workspaces"
  data: Array<{ id: number; title: string; store?: { status?: string } | null }>
}

const activity = [
  { time: "09:10", title: "沙箱就绪", detail: "容器已使用 Node 18 启动" },
  { time: "09:42", title: "静态扫描", detail: "上传链路污染流" },
  { time: "10:05", title: "模糊测试", detail: "疑似路径穿越" },
  { time: "10:33", title: "PoC 已完成", detail: "本地验证通过" }
]

const artifacts = [
  { name: "server.js", type: "入口", risk: "中" },
  { name: "routes/upload.ts", type: "处理器", risk: "高" },
  { name: "docker-compose.yml", type: "基础设施", risk: "低" }
]

const knowledge = [
  {
    title: "multer 路径规范化",
    source: "文档",
    summary: "文件名绕过依赖 ../ + Unicode 规范化"
  },
  {
    title: "Node 18 fs.cp",
    source: "发布说明",
    summary: "递归复制默认保留符号链接"
  }
]

function App() {
  const [workspaceName, setWorkspaceName] = useState("")
  const [workspaceType, setWorkspaceType] = useState("whitebox")
  const [workspaceHints, setWorkspaceHints] = useState("")
  const [workspaceUrl, setWorkspaceUrl] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)

  useEffect(() => {
    fetch("http://localhost:3001/api/workspaces")
      .then((res) => res.json())
      .then((data: WorkspaceEvent["data"]) => {
        const mapped = data.map((item) => ({
          id: `ws-${String(item.id).padStart(3, "0")}`,
          name: item.title,
          status: item.store?.status ?? "unknown"
        }))
        setWorkspaces(mapped)
        if (!activeWorkspace && mapped.length > 0) setActiveWorkspace(mapped[0]?.id ?? null)
      })
      .catch(() => {})

    const ws = new WebSocket("ws://localhost:3001/ws")
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WorkspaceEvent
        if (payload.type === "workspaces") {
          const mapped = payload.data.map((item) => ({
            id: `ws-${String(item.id).padStart(3, "0")}`,
            name: item.title,
            status: item.store?.status ?? "unknown"
          }))
          setWorkspaces(mapped)
          if (!activeWorkspace && mapped.length > 0) setActiveWorkspace(mapped[0]?.id ?? null)
        }
      } catch {
        // ignore malformed payload
      }
    }
    return () => ws.close()
  }, [activeWorkspace])

  const activeWorkspaceLabel = useMemo(() => {
    return workspaces.find((workspace) => workspace.id === activeWorkspace)?.name ?? "未知"
  }, [activeWorkspace, workspaces])

  const attachmentLabel = useMemo(() => {
    if (attachments.length === 0) return "未选择文件"
    return attachments.map((file) => file.name).join(", ")
  }, [attachments])

  async function handleWorkspaceCreate() {
    if (!workspaceName.trim()) return
    const hints = workspaceHints
      .split("\n")
      .map((hint) => hint.trim())
      .filter(Boolean)

    if (attachments.length > 0) {
      const formData = new FormData()
      formData.append(
        "payload",
        JSON.stringify({
          title: workspaceName.trim(),
          description: workspaceName.trim(),
          hints,
          remote_url: workspaceUrl || undefined,
          type: workspaceType
        })
      )
      attachments.forEach((file) => {
        formData.append("files", file)
      })
      await fetch("http://localhost:3001/api/workspaces/with-attachments", {
        method: "POST",
        body: formData
      })
    } else {
      await fetch("http://localhost:3001/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: workspaceName.trim(),
          description: workspaceName.trim(),
          hints,
          remote_url: workspaceUrl || undefined,
          type: workspaceType
        })
      })
    }

    setWorkspaceName("")
    setWorkspaceHints("")
    setWorkspaceUrl("")
    setAttachments([])
  }

  async function handleWorkspaceSwitch(value: string) {
    setActiveWorkspace(value)
    setIsSwitching(true)
    const id = Number(value.replace("ws-", ""))
    await fetch(`http://localhost:3001/api/workspaces/${id}/switch`, { method: "POST" }).catch(() => {})
    setIsSwitching(false)
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efe1_0%,#f1e4cf_45%,#e6d2b6_100%)]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-[0.32em] text-amber-900/70">CTF Ops</span>
              <Separator className="w-12 bg-amber-900/30" />
              <Badge className="rounded-full bg-amber-200 text-amber-900">当前工作区</Badge>
            </div>
            <h1 className="text-3xl font-semibold text-amber-950 md:text-4xl">密语档案 · 多 Agent CTF 控制台</h1>
            <p className="max-w-2xl text-sm text-amber-900/70 md:text-base">
              统一管理环境搭建、漏洞研究与知识检索，保持可复现的解题过程与持久状态。
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button className="rounded-full px-6">启动流程</Button>
            <Button variant="outline" className="rounded-full border-amber-900/30 text-amber-900">
              导出报告
            </Button>
          </div>
        </header>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl text-amber-950">工作区脉搏</CardTitle>
                  <CardDescription className="text-amber-900/60">当前挑战环境的关键指标。</CardDescription>
                </div>
                <Badge variant="outline" className="border-amber-400/60 text-amber-900">
                  {workspaces.find((workspace) => workspace.id === activeWorkspace)?.status ?? "unknown"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-amber-900/10 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-amber-900/60">Agents</p>
                  <p className="mt-3 text-2xl font-semibold text-amber-950">3</p>
                  <p className="text-xs text-amber-900/60">Env · CTF · Hiro</p>
                </div>
                <div className="rounded-2xl border border-amber-900/10 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-amber-900/60">Artifacts</p>
                  <p className="mt-3 text-2xl font-semibold text-amber-950">12</p>
                  <p className="text-xs text-amber-900/60">代码 · 配置 · pcap</p>
                </div>
                <div className="rounded-2xl border border-amber-900/10 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-[0.28em] text-amber-900/60">Knowledge</p>
                  <p className="mt-3 text-2xl font-semibold text-amber-950">5 条</p>
                  <p className="text-xs text-amber-900/60">已索引与验证</p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-900/10 bg-white/80 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-amber-950">利用就绪度</p>
                    <p className="text-xs text-amber-900/60">PoC 到可复现</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-950">68%</span>
                </div>
                <Progress value={68} className="mt-4" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                    上传向量
                  </Badge>
                  <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                    路径穿越
                  </Badge>
                  <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                    沙箱确认
                  </Badge>
                </div>
              </div>

              <Tabs defaultValue="activity" className="w-full">
                <TabsList className="bg-amber-100/70">
                  <TabsTrigger value="activity">动态</TabsTrigger>
                  <TabsTrigger value="artifacts">附件</TabsTrigger>
                  <TabsTrigger value="knowledge">知识</TabsTrigger>
                </TabsList>
                <TabsContent value="activity" className="mt-4 space-y-3">
                  {activity.map((item) => (
                    <div
                      key={item.time}
                      className="flex items-center justify-between rounded-xl border border-amber-900/10 bg-white/80 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-amber-950">{item.title}</p>
                        <p className="text-xs text-amber-900/60">{item.detail}</p>
                      </div>
                      <span className="text-xs text-amber-900/60">{item.time}</span>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="artifacts" className="mt-4 grid gap-3">
                  {artifacts.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-xl border border-amber-900/10 bg-white/80 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-amber-950">{item.name}</p>
                        <p className="text-xs text-amber-900/60">{item.type}</p>
                      </div>
                      <Badge variant="outline" className="border-amber-400/60 text-amber-900">
                        {item.risk}
                      </Badge>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="knowledge" className="mt-4 grid gap-3">
                  {knowledge.map((item) => (
                    <div key={item.title} className="rounded-xl border border-amber-900/10 bg-white/80 px-4 py-3">
                      <p className="text-sm font-medium text-amber-950">{item.title}</p>
                      <p className="text-xs text-amber-900/60">{item.summary}</p>
                      <Badge variant="secondary" className="mt-2 bg-amber-100 text-amber-900">
                        {item.source}
                      </Badge>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg text-amber-950">创建工作区</CardTitle>
                <CardDescription className="text-amber-900/60">创建新工作区并上传附件。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="工作区标题"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="bg-white"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <Select value={workspaceType} onValueChange={setWorkspaceType}>
                    <SelectTrigger>
                      <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whitebox">白盒</SelectItem>
                      <SelectItem value="blackbox">黑盒</SelectItem>
                      <SelectItem value="graybox">灰盒</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-between rounded-xl border border-amber-900/10 bg-white px-3 py-2">
                    <span className="text-sm text-amber-900/70">远程地址</span>
                    <Switch
                      checked={Boolean(workspaceUrl)}
                      onCheckedChange={(checked) => (!checked ? setWorkspaceUrl("") : null)}
                    />
                  </div>
                </div>
                <Input
                  placeholder="远程 URL（可选）"
                  value={workspaceUrl}
                  onChange={(event) => setWorkspaceUrl(event.target.value)}
                  className="bg-white"
                />
                <Textarea
                  placeholder="提示信息（每行一条）"
                  value={workspaceHints}
                  onChange={(event) => setWorkspaceHints(event.target.value)}
                  className="min-h-[120px]"
                />
                <div className="space-y-2 rounded-xl border border-amber-900/10 bg-white px-3 py-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-amber-900/60" htmlFor="attachments">
                    附件
                  </label>
                  <Input
                    type="file"
                    id="attachments"
                    multiple
                    className="bg-white"
                    onChange={(event) => setAttachments(event.target.files ? Array.from(event.target.files) : [])}
                  />
                  <p className="text-xs text-amber-900/60">{attachmentLabel}</p>
                </div>
                <Button className="w-full rounded-full" onClick={handleWorkspaceCreate}>
                  创建工作区
                </Button>
              </CardContent>
            </Card>

            <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg text-amber-950">切换工作区</CardTitle>
                <CardDescription className="text-amber-900/60">已创建的工作区</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={activeWorkspace ?? undefined} onValueChange={handleWorkspaceSwitch}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择工作区" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                      workspace.id === activeWorkspace
                        ? "border-amber-500/60 bg-amber-50"
                        : "border-amber-900/10 bg-white/80"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-amber-950">{workspace.name}</p>
                      <p className="text-xs text-amber-900/60">{workspace.id}</p>
                    </div>
                    <Badge variant="outline" className="border-amber-400/60 text-amber-900">
                      {workspace.status}
                    </Badge>
                  </div>
                ))}
                {isSwitching ? <p className="text-xs text-amber-900/60">正在切换工作区...</p> : null}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg text-amber-950">Runbook 记录</CardTitle>
              <CardDescription className="text-amber-900/60">用于复现的结构化记录。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                defaultValue={`1. Verified upload route accepts multipart with filename.
2. Discovered traversal via unicode normalization.
3. PoC reads /etc/passwd on container.`}
                className="min-h-[180px]"
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="border-amber-900/20 text-amber-900">
                  保存快照
                </Button>
                <Button className="rounded-full">生成 WriteUp</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg text-amber-950">协作成员</CardTitle>
              <CardDescription className="text-amber-900/60">人工监督与确认。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-amber-900/10 bg-white/80 p-3">
                <Avatar>
                  <AvatarFallback>SA</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-amber-950">Shoreline Analyst</p>
                  <p className="text-xs text-amber-900/60">正在复核 PoC</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-amber-900/10 bg-white/80 p-3">
                <Avatar>
                  <AvatarFallback>QA</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-amber-950">Quill Auditor</p>
                  <p className="text-xs text-amber-900/60">正在验证利用链</p>
                </div>
              </div>
              <Button variant="outline" className="w-full border-amber-900/20 text-amber-900">
                邀请审阅人
              </Button>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-amber-900/10 pt-6 text-xs text-amber-900/60 md:flex-row">
          <span>工作区：{activeWorkspaceLabel} · 3 秒前同步</span>
          <span>CTF Ops 控制台 · v1.0</span>
        </footer>
      </div>
    </div>
  )
}

export default App
