import {
  isPlatformAuthError,
  type AuthSession,
  type CTFPlatformPlugin,
  type PluginAuthConfig,
} from "../../../../../../../plugins/index.ts"

export interface PlatformAuthManagerOptions {
  onStateChanged?: () => void
}

export interface PlatformAuthManagerInitOptions {
  plugin: CTFPlatformPlugin
  authConfig?: PluginAuthConfig
  restoredSession?: AuthSession
}

export class PlatformAuthManager {
  private plugin?: CTFPlatformPlugin
  private authConfig?: PluginAuthConfig
  private session?: AuthSession
  private readonly onStateChanged: () => void

  constructor(options: PlatformAuthManagerOptions = {}) {
    this.onStateChanged = options.onStateChanged ?? (() => {})
  }

  initialize(options: PlatformAuthManagerInitOptions) {
    this.plugin = options.plugin
    this.authConfig = options.authConfig
    this.session = normalizeAuthSession(options.restoredSession)
  }

  getSessionState() {
    return this.session
  }

  async withSession<T>(
    operation: (session: AuthSession) => Promise<T>,
    allowRetry = true,
  ): Promise<T> {
    const session = await this.ensureSession()

    try {
      return await operation(session)
    } catch (error) {
      if (!allowRetry || !isPlatformAuthError(error)) {
        throw error
      }

      this.setSession(undefined)
      const refreshedSession = await this.ensureSession()
      return operation(refreshedSession)
    }
  }

  private async ensureSession() {
    const plugin = this.requirePlugin()

    if (this.session) {
      try {
        await plugin.validateSession(this.session)
        return this.session
      } catch (error) {
        if (!isPlatformAuthError(error)) {
          throw error
        }

        this.setSession(undefined)
      }
    }

    const session = await plugin.login(this.authConfig)
    this.setSession(session)
    return session
  }

  private requirePlugin() {
    if (!this.plugin) {
      throw new Error("Platform plugin is not initialized for auth manager")
    }

    return this.plugin
  }

  private setSession(session: AuthSession | undefined) {
    this.session = session
    this.onStateChanged()
  }
}

function normalizeAuthSession(session: AuthSession | undefined) {
  if (!session) {
    return undefined
  }

  if (!isAuthMode(session.mode) || typeof session.refreshable !== "boolean") {
    return undefined
  }

  return {
    mode: session.mode,
    cookie: typeof session.cookie === "string" ? session.cookie : undefined,
    bearerToken: typeof session.bearerToken === "string" ? session.bearerToken : undefined,
    expiresAt: typeof session.expiresAt === "number" ? session.expiresAt : undefined,
    refreshable: session.refreshable,
  } satisfies AuthSession
}

function isAuthMode(value: unknown): value is AuthSession["mode"] {
  return value === "manual" || value === "cookie" || value === "token" || value === "credentials"
}
