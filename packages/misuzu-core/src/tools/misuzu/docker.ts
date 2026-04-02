import { type Static, Type } from "@sinclair/typebox"
import { defaultBashOperations, type BashOperations } from "../base/bash.ts"

function dockerCmd(args: string) {
  return `docker ${args}`
}

const buildSchema = Type.Object({
  dockerfile: Type.String({ description: "Path to the Dockerfile" }),
  tag: Type.String({ description: "Image tag, e.g. 'my-app:latest'" }),
  context: Type.Optional(
    Type.String({ description: "Build context directory (default: current directory)" }),
  ),
})

const runSchema = Type.Object({
  image: Type.String({ description: "Image to run" }),
  command: Type.Optional(Type.String({ description: "Command to execute inside the container" })),
  name: Type.Optional(Type.String({ description: "Container name" })),
  ports: Type.Optional(Type.String({ description: "Port mapping, e.g. '8080:80'" })),
  detach: Type.Optional(Type.Boolean({ description: "Run in background (default: false)" })),
  volumes: Type.Optional(Type.String({ description: "Volume mapping, e.g. '/host:/container'" })),
})

const execSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
  command: Type.String({ description: "Command to execute" }),
})

const stopSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
})

const rmSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
  force: Type.Optional(Type.Boolean({ description: "Force remove (default: false)" })),
})

async function execDocker(ops: BashOperations, cwd: string, command: string, signal?: AbortSignal) {
  let output = ""
  const { exitCode } = await ops.exec(command, cwd, {
    onData: (data) => {
      output += data.toString()
    },
    signal,
  })

  return { output, exitCode }
}

export function createDockerTools(cwd: string, operations: BashOperations = defaultBashOperations) {
  const dockerBuildTool = {
    name: "docker_build",
    label: "docker build",
    description: "Build a Docker image from a Dockerfile.",
    parameters: buildSchema,
    execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as Static<typeof buildSchema>
      const command = dockerCmd(
        `build -f ${params.dockerfile} -t ${params.tag} ${params.context ?? "."}`,
      )
      const { output, exitCode } = await execDocker(operations, cwd, command, signal)

      if (exitCode !== 0) throw new Error(`docker build failed:\n${output}`)
      return { content: [{ type: "text", text: output }], details: { exitCode } }
    },
  }

  const dockerRunTool = {
    name: "docker_run",
    label: "docker run",
    description: "Run a Docker container. Use detach=true for background execution.",
    parameters: runSchema,
    execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as Static<typeof runSchema>
      const parts = ["run"]
      if (params.detach) parts.push("-d")
      if (params.name) parts.push(`--name ${params.name}`)
      if (params.ports) parts.push(`-p ${params.ports}`)
      if (params.volumes) parts.push(`-v ${params.volumes}`)
      parts.push(params.image)
      if (params.command) parts.push(params.command)

      const { output, exitCode } = await execDocker(
        operations,
        cwd,
        dockerCmd(parts.join(" ")),
        signal,
      )
      if (exitCode !== 0) throw new Error(`docker run failed:\n${output}`)
      return { content: [{ type: "text", text: output.trim() }], details: { exitCode } }
    },
  }

  const dockerExecTool = {
    name: "docker_exec",
    label: "docker exec",
    description: "Execute a command in a running container.",
    parameters: execSchema,
    execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as Static<typeof execSchema>
      const command = dockerCmd(`exec ${params.container} ${params.command}`)
      const { output, exitCode } = await execDocker(operations, cwd, command, signal)

      if (exitCode !== 0) throw new Error(`docker exec failed:\n${output}`)
      return { content: [{ type: "text", text: output }], details: { exitCode } }
    },
  }

  const dockerStopTool = {
    name: "docker_stop",
    label: "docker stop",
    description: "Stop a running container.",
    parameters: stopSchema,
    execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as Static<typeof stopSchema>
      const { output, exitCode } = await execDocker(
        operations,
        cwd,
        dockerCmd(`stop ${params.container}`),
        signal,
      )

      return {
        content: [{ type: "text", text: output.trim() || `Container ${params.container} stopped` }],
        details: { exitCode },
      }
    },
  }

  const dockerRmTool = {
    name: "docker_rm",
    label: "docker rm",
    description: "Remove a container.",
    parameters: rmSchema,
    execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
      const params = rawParams as Static<typeof rmSchema>
      const flags = params.force ? "-f" : ""
      const { output, exitCode } = await execDocker(
        operations,
        cwd,
        dockerCmd(`rm ${flags} ${params.container}`),
        signal,
      )

      return {
        content: [{ type: "text", text: output.trim() || `Container ${params.container} removed` }],
        details: { exitCode },
      }
    },
  }

  const dockerTools = [dockerBuildTool, dockerRunTool, dockerExecTool, dockerStopTool, dockerRmTool]

  return {
    dockerBuildTool,
    dockerRunTool,
    dockerExecTool,
    dockerStopTool,
    dockerRmTool,
    dockerTools,
  }
}
