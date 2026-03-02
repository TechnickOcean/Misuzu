import pino from "pino"

const level = process.env.LOG_LEVEL || "info"

const logger = pino({
  level,
  base: undefined
})

export default logger
