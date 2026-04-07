import type { WsServerMessage } from "@shared/protocol.ts"

type MessageHandler = (message: WsServerMessage) => void

export class RealtimeClient {
  connect(topic: string, handler: MessageHandler) {
    const wsUrl = new URL("/ws", window.location.origin)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    wsUrl.searchParams.set("topic", topic)

    const socket = new WebSocket(wsUrl)
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as WsServerMessage
        handler(parsed)
      } catch {
        // Ignore malformed messages to keep socket alive.
      }
    })

    return () => {
      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        return
      }
      socket.close()
    }
  }
}
