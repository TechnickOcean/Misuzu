import { type Static, Type } from "@sinclair/typebox";
import { defaultBashOperations } from "../base/bash.js";

const ops = defaultBashOperations;

function dockerCmd(args: string): string {
  return `docker ${args}`;
}

const buildSchema = Type.Object({
  dockerfile: Type.String({ description: "Path to the Dockerfile" }),
  tag: Type.String({ description: "Image tag, e.g. 'my-app:latest'" }),
  context: Type.Optional(
    Type.String({ description: "Build context directory (default: current directory)" }),
  ),
});

export const dockerBuildTool = {
  name: "docker_build",
  label: "docker build",
  description: "Build a Docker image from a Dockerfile.",
  parameters: buildSchema,
  execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
    const params = rawParams as Static<typeof buildSchema>;
    const cmd = dockerCmd(
      `build -f ${params.dockerfile} -t ${params.tag} ${params.context ?? "."}`,
    );
    let output = "";
    const { exitCode } = await ops.exec(cmd, process.cwd(), {
      onData: (d) => {
        output += d.toString();
      },
      signal,
    });
    if (exitCode !== 0) throw new Error(`docker build failed:\n${output}`);
    return { content: [{ type: "text" as const, text: output }], details: { exitCode } };
  },
};

const runSchema = Type.Object({
  image: Type.String({ description: "Image to run" }),
  command: Type.Optional(Type.String({ description: "Command to execute inside the container" })),
  name: Type.Optional(Type.String({ description: "Container name" })),
  ports: Type.Optional(Type.String({ description: "Port mapping, e.g. '8080:80'" })),
  detach: Type.Optional(Type.Boolean({ description: "Run in background (default: false)" })),
  volumes: Type.Optional(Type.String({ description: "Volume mapping, e.g. '/host:/container'" })),
});

export const dockerRunTool = {
  name: "docker_run",
  label: "docker run",
  description: "Run a Docker container. Use detach=true for background execution.",
  parameters: runSchema,
  execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
    const params = rawParams as Static<typeof runSchema>;
    const parts = ["run"];
    if (params.detach) parts.push("-d");
    if (params.name) parts.push(`--name ${params.name}`);
    if (params.ports) parts.push(`-p ${params.ports}`);
    if (params.volumes) parts.push(`-v ${params.volumes}`);
    parts.push(params.image);
    if (params.command) parts.push(params.command);
    let output = "";
    const { exitCode } = await ops.exec(dockerCmd(parts.join(" ")), process.cwd(), {
      onData: (d) => {
        output += d.toString();
      },
      signal,
    });
    if (exitCode !== 0) throw new Error(`docker run failed:\n${output}`);
    return { content: [{ type: "text" as const, text: output.trim() }], details: { exitCode } };
  },
};

const execSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
  command: Type.String({ description: "Command to execute" }),
  interactive: Type.Optional(
    Type.Boolean({ description: "Use -it for interactive (default: false)" }),
  ),
});

export const dockerExecTool = {
  name: "docker_exec",
  label: "docker exec",
  description: "Execute a command in a running container.",
  parameters: execSchema,
  execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
    const params = rawParams as Static<typeof execSchema>;
    const flags = params.interactive ? "-it" : "";
    const cmd = dockerCmd(`exec ${flags} ${params.container} ${params.command}`);
    let output = "";
    const { exitCode } = await ops.exec(cmd, process.cwd(), {
      onData: (d) => {
        output += d.toString();
      },
      signal,
    });
    if (exitCode !== 0) throw new Error(`docker exec failed:\n${output}`);
    return { content: [{ type: "text" as const, text: output }], details: { exitCode } };
  },
};

const stopSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
});

export const dockerStopTool = {
  name: "docker_stop",
  label: "docker stop",
  description: "Stop a running container.",
  parameters: stopSchema,
  execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
    const params = rawParams as Static<typeof stopSchema>;
    let output = "";
    const { exitCode } = await ops.exec(dockerCmd(`stop ${params.container}`), process.cwd(), {
      onData: (d) => {
        output += d.toString();
      },
      signal,
    });
    return {
      content: [
        { type: "text" as const, text: output.trim() || `Container ${params.container} stopped` },
      ],
      details: { exitCode },
    };
  },
};

const rmSchema = Type.Object({
  container: Type.String({ description: "Container name or ID" }),
  force: Type.Optional(Type.Boolean({ description: "Force remove (default: false)" })),
});

export const dockerRmTool = {
  name: "docker_rm",
  label: "docker rm",
  description: "Remove a container.",
  parameters: rmSchema,
  execute: async (_id: string, rawParams: unknown, signal?: AbortSignal) => {
    const params = rawParams as Static<typeof rmSchema>;
    const flags = params.force ? "-f" : "";
    let output = "";
    const { exitCode } = await ops.exec(
      dockerCmd(`rm ${flags} ${params.container}`),
      process.cwd(),
      {
        onData: (d) => {
          output += d.toString();
        },
        signal,
      },
    );
    return {
      content: [
        { type: "text" as const, text: output.trim() || `Container ${params.container} removed` },
      ],
      details: { exitCode },
    };
  },
};

export const dockerTools = [
  dockerBuildTool,
  dockerRunTool,
  dockerExecTool,
  dockerStopTool,
  dockerRmTool,
];
