import type { WsServerMessage } from "../../shared/protocol.ts"

type MessageListener = (message: WsServerMessage) => void

export class EventBus {
  private readonly listeners = new Map<string, Set<MessageListener>>()

  subscribe(topic: string, listener: MessageListener) {
    const topicListeners = this.listeners.get(topic) ?? new Set<MessageListener>()
    topicListeners.add(listener)
    this.listeners.set(topic, topicListeners)

    return () => {
      const current = this.listeners.get(topic)
      if (!current) {
        return
      }

      current.delete(listener)
      if (current.size === 0) {
        this.listeners.delete(topic)
      }
    }
  }

  publish(topic: string, message: WsServerMessage) {
    const topicListeners = this.listeners.get(topic)
    if (!topicListeners) {
      return
    }

    for (const listener of topicListeners) {
      try {
        listener(message)
      } catch {
        topicListeners.delete(listener)
      }
    }

    if (topicListeners.size === 0) {
      this.listeners.delete(topic)
    }
  }
}
