export interface ServiceToken<T> {
  readonly key: string
  readonly _type?: T
}

export function createToken<T>(key: string): ServiceToken<T> {
  return { key }
}

type Factory<T> = (container: ServiceContainer) => T

export class ServiceContainer {
  private readonly factories = new Map<string, Factory<unknown>>()
  private readonly singletons = new Map<string, unknown>()

  registerSingleton<T>(token: ServiceToken<T>, factory: Factory<T>) {
    this.factories.set(token.key, factory)
  }

  resolve<T>(token: ServiceToken<T>) {
    if (this.singletons.has(token.key)) {
      return this.singletons.get(token.key) as T
    }

    const factory = this.factories.get(token.key)
    if (!factory) {
      throw new Error(`Missing service for token: ${token.key}`)
    }

    const instance = factory(this) as T
    this.singletons.set(token.key, instance)
    return instance
  }
}
