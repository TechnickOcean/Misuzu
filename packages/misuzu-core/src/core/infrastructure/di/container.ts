export type Token<T> = symbol & { readonly __type?: T }

type Resolver<T> = (container: Container) => T

export class Container {
  private readonly singletonResolvers = new Map<Token<unknown>, Resolver<unknown>>()
  private readonly transientResolvers = new Map<Token<unknown>, Resolver<unknown>>()
  private readonly singletonInstances = new Map<Token<unknown>, unknown>()

  registerSingleton<T>(token: Token<T>, resolver: Resolver<T>) {
    this.singletonResolvers.set(token, resolver)
  }

  registerTransient<T>(token: Token<T>, resolver: Resolver<T>) {
    this.transientResolvers.set(token, resolver)
  }

  registerValue<T>(token: Token<T>, value: T) {
    this.singletonInstances.set(token, value)
  }

  resolve<T>(token: Token<T>): T {
    if (this.singletonInstances.has(token)) {
      return this.singletonInstances.get(token) as T
    }

    const singletonResolver = this.singletonResolvers.get(token)
    if (singletonResolver) {
      const instance = singletonResolver(this) as T
      this.singletonInstances.set(token, instance)
      return instance
    }

    const transientResolver = this.transientResolvers.get(token)
    if (transientResolver) {
      return transientResolver(this) as T
    }

    throw new Error(
      `Missing dependency for token: ${String(token.description ?? token.toString())}`,
    )
  }
}

export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>
}

export function createContainer() {
  return new Container()
}
