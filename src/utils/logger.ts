import pino from "pino"

const logger = pino({
  level: "debug",
  base: undefined
})

export default logger
