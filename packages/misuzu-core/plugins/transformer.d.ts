import type { CTFPlatformPlugin } from "./protocol.ts"
export interface PluginToolTransformerOptions {
  namespace?: string
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
  plugin: CTFPlatformPlugin,
  options?: PluginToolTransformerOptions,
): PluginTool[]
