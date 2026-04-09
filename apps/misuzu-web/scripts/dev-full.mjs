import { spawn } from "node:child_process"
import process from "node:process"

const targets = [
  {
    name: "client",
    color: "\x1b[36m",
    args: ["run", "dev:client", "--host"],
  },
  {
    name: "server",
    color: "\x1b[33m",
    args: ["run", "dev:server"],
  },
]

const resetColor = "\x1b[0m"
const children = []
let shuttingDown = false

for (const target of targets) {
  const child = spawn(resolveVpBinary(), target.args, {
    cwd: process.cwd(),
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
    windowsHide: true,
  })

  children.push({ child, target })
  pipeOutput(child.stdout, target, false)
  pipeOutput(child.stderr, target, true)

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return
    }

    const resolvedCode = typeof code === "number" ? code : 1
    const detail = signal ? `signal ${signal}` : `code ${String(resolvedCode)}`
    process.stderr.write(`${prefix(target)} process exited with ${detail}\n`)
    shutdown(resolvedCode)
  })

  child.on("error", (error) => {
    if (shuttingDown) {
      return
    }

    process.stderr.write(`${prefix(target)} failed to start: ${error.message}\n`)
    shutdown(1)
  })
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

function resolveVpBinary() {
  return "vp"
}

function prefix(target) {
  return `${target.color}[${target.name}]${resetColor}`
}

function pipeOutput(stream, target, isError) {
  if (!stream) {
    return
  }

  let buffer = ""
  stream.on("data", (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const output = `${prefix(target)} ${line}\n`
      if (isError) {
        process.stderr.write(output)
      } else {
        process.stdout.write(output)
      }
    }
  })

  stream.on("end", () => {
    if (!buffer) {
      return
    }

    const output = `${prefix(target)} ${buffer}\n`
    if (isError) {
      process.stderr.write(output)
    } else {
      process.stdout.write(output)
    }
  })
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  for (const { child } of children) {
    terminateChild(child)
  }

  setTimeout(() => {
    process.exit(exitCode)
  }, 150)
}

function terminateChild(child) {
  if (child.exitCode !== null || child.killed) {
    return
  }

  if (process.platform === "win32") {
    const pid = child.pid
    if (!pid) {
      return
    }

    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    })
    return
  }

  child.kill("SIGTERM")
}
