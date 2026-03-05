import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { WorkspaceRecord } from "@/types"

const API_BASE = "http://localhost:3001"

export default function WorkspaceList() {
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspaceName, setWorkspaceName] = useState("")
  const [workspaceType, setWorkspaceType] = useState("whitebox")
  const [workspaceHints, setWorkspaceHints] = useState("")
  const [workspaceUrl, setWorkspaceUrl] = useState("")
  const [isRemote, setIsRemote] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])

  useEffect(() => {
    fetch(`${API_BASE}/api/workspaces`)
      .then((res) => res.json())
      .then((data: WorkspaceRecord[]) => {
        setWorkspaces(data)
      })
      .catch(() => {})
  }, [])

  const attachmentLabel = useMemo(() => {
    if (attachments.length === 0) return "未选择文件"
    return attachments.map((file) => file.name).join(", ")
  }, [attachments])

  async function refreshWorkspaces() {
    const data = await fetch(`${API_BASE}/api/workspaces`).then((res) => res.json())
    setWorkspaces(data)
  }

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
          remote_url: isRemote ? workspaceUrl || undefined : undefined,
          type: workspaceType
        })
      )
      attachments.forEach((file) => {
        formData.append("files", file)
      })
      await fetch(`${API_BASE}/api/workspaces/with-attachments`, {
        method: "POST",
        body: formData
      })
    } else {
      await fetch(`${API_BASE}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: workspaceName.trim(),
          description: workspaceName.trim(),
          hints,
          remote_url: isRemote ? workspaceUrl || undefined : undefined,
          type: workspaceType
        })
      })
    }

    await refreshWorkspaces()

    setWorkspaceName("")
    setWorkspaceHints("")
    setWorkspaceUrl("")
    setIsRemote(false)
    setAttachments([])
  }

  async function handleWorkspaceDelete(event: React.MouseEvent<HTMLButtonElement>, workspaceId: string) {
    event.stopPropagation()
    await fetch(`${API_BASE}/api/workspaces/${workspaceId}`, { method: "DELETE" })
    await refreshWorkspaces()
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f8efe1_0%,#f1e4cf_45%,#e6d2b6_100%)]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-10">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.32em] text-amber-900/70">Hatsuboshi CTF Agent</span>
            <Separator className="w-12 bg-amber-900/30" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-amber-950 md:text-4xl">Misuzu · 工作区概览</h1>
          <p className="mt-2 max-w-2xl text-sm text-amber-900/70 md:text-base">选择现有挑战或创建新环境以开始调查。</p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <h2 className="text-xl font-medium text-amber-950">现有工作区</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {workspaces.map((ws) => (
                <Card
                  key={ws.id}
                  className="group cursor-pointer border-amber-900/10 bg-white/70 shadow-sm backdrop-blur transition-all hover:border-amber-500/30 hover:shadow-md"
                  onClick={() => navigate(`/workspace/${ws.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg text-amber-950 group-hover:text-amber-700">{ws.title}</CardTitle>
                        <CardDescription className="text-xs text-amber-900/50">ID: {ws.id}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-amber-400/60 text-amber-900">
                          idle
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-full px-3 text-xs text-amber-900/60 hover:text-amber-950"
                          onClick={(event) => handleWorkspaceDelete(event, ws.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-xs text-amber-900/60">
                      <div>
                        <span className="font-semibold text-amber-950">{ws.stats?.findings_count ?? 0}</span> Findings
                      </div>
                      <div>
                        <span className="font-semibold text-amber-950">{ws.agent_state?.step_count ?? 0}</span> Steps
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {workspaces.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-amber-900/20 bg-white/30 py-12 text-center text-amber-900/50">
                  <p>暂无工作区</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-medium text-amber-950">创建新环境</h2>
            <Card className="border-amber-900/10 bg-white/70 shadow-sm backdrop-blur">
              <CardContent className="space-y-4 pt-6">
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
                    <span className="text-xs text-amber-900/70">远程</span>
                    <Switch checked={isRemote} onCheckedChange={setIsRemote} />
                  </div>
                </div>
                {isRemote && (
                  <Input
                    placeholder="远程 URL"
                    value={workspaceUrl}
                    onChange={(event) => setWorkspaceUrl(event.target.value)}
                    className="bg-white"
                  />
                )}
                <Textarea
                  placeholder="提示信息（每行一条）"
                  value={workspaceHints}
                  onChange={(event) => setWorkspaceHints(event.target.value)}
                  className="min-h-[80px] bg-white"
                />
                <div className="space-y-2 rounded-xl border border-amber-900/10 bg-white px-3 py-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-amber-900/60" htmlFor="attachments">
                    附件
                  </label>
                  <Input
                    type="file"
                    id="attachments"
                    multiple
                    className="h-8 text-xs file:mr-4 file:rounded-full file:border-0 file:bg-amber-100 file:px-2 file:text-amber-700 hover:file:bg-amber-200"
                    onChange={(event) => setAttachments(event.target.files ? Array.from(event.target.files) : [])}
                  />
                  <p className="truncate text-xs text-amber-900/60">{attachmentLabel}</p>
                </div>
                <Button className="w-full rounded-full" onClick={handleWorkspaceCreate}>
                  创建工作区
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
