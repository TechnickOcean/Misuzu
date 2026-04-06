export interface PluginToolTransformerOptions {
  namespace?: string
}
export interface SolverToolPlugin {
  meta: {
    id: string
    name: string
  }
  listChallenges(): Promise<unknown>
  getChallenge(challengeId: number): Promise<unknown>
  submitFlagRaw(challengeId: number, flag: string): Promise<unknown>
  downloadAttachment?(
    challengeId: number,
    attachmentIndex: number,
    fileName?: string,
  ): Promise<unknown>
  openContainer?(challengeId: number): Promise<unknown>
  destroyContainer?(challengeId: number): Promise<unknown>
}
export interface PluginTool {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ) => Promise<{
    content: Array<{
      type: "text"
      text: string
    }>
    details: unknown
  }>
}
export declare function transformPluginToTools(
  plugin: SolverToolPlugin,
  options?: PluginToolTransformerOptions,
): PluginTool[]
