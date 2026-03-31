const queues = new Map<string, Promise<unknown>>()

export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(filePath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(filePath, next)

  try {
    return await next
  } finally {
    if (queues.get(filePath) === next) queues.delete(filePath)
  }
}
