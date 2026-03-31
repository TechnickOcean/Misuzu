import { randomUUID } from "node:crypto"

export class SessionContext {
  readonly sessionId: string

  constructor(sessionId: string = randomUUID()) {
    this.sessionId = sessionId
  }
}
