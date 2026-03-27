import {
  getModel,
  registerProxyProvider,
  type Api,
  type Model,
  type ProxyProviderOptions,
} from "@mariozechner/pi-ai"

export { type ProxyProviderOptions }

export class ProxyProvider {
  readonly provider: string

  constructor(private readonly options: ProxyProviderOptions) {
    this.provider = options.provider
  }

  register(): Model<Api>[] {
    return registerProxyProvider(this.options)
  }

  getModel(modelId: string): Model<Api> | undefined {
    return getModel(this.provider as any, modelId as any) as Model<Api> | undefined
  }

  requireModel(modelId: string): Model<Api> {
    const model = this.getModel(modelId)
    if (!model) {
      throw new Error(`Unknown model: ${this.provider}/${modelId}`)
    }
    return model
  }
}
