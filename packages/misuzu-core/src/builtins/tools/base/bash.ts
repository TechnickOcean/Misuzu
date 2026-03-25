import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { truncateTail, type TruncationResult } from "../utils/truncate.js";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
  exitCode: number | null;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

export interface BashToolOptions {
  operations?: BashOperations;
}

export function createBashTool(
  cwd: string,
  options?: BashToolOptions,
): AgentTool<typeof bashSchema> {
  const ops = options?.operations ?? defaultBashOperations;

  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command. Use for running scripts, installing packages, or any shell operation.",
    parameters: bashSchema,
    async execute(toolCallId, params: BashToolInput, signal?: AbortSignal) {
      let output = "";
      let fullOutputPath: string | undefined;
      let stream: ReturnType<typeof createWriteStream> | undefined;

      const onData = (data: Buffer) => {
        const text = data.toString("utf-8");
        output += text;

        if (output.length > 50_000 && !fullOutputPath) {
          fullOutputPath = join(tmpdir(), `misuzu-bash-${randomBytes(4).toString("hex")}.log`);
          stream = createWriteStream(fullOutputPath);
          stream.write(output);
        }
        stream?.write(text);
      };

      const timeoutMs = params.timeout ? params.timeout * 1000 : undefined;
      const { exitCode } = await ops.exec(params.command, cwd, {
        onData,
        signal,
        timeout: timeoutMs,
      });

      stream?.end();

      const truncation = truncateTail(output);

      let text = truncation.content;
      if (truncation.truncated) {
        const endLine = truncation.totalLines;
        const startLine = endLine - truncation.outputLines + 1;
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}]`;
      }
      if (fullOutputPath) text += `\n\n[Full output saved to: ${fullOutputPath}]`;

      const details: BashToolDetails = { exitCode, truncation, fullOutputPath };

      if (exitCode !== 0) {
        throw new Error(`Command exited with code ${exitCode}.\nOutput:\n${text}`);
      }

      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  };
}

export const defaultBashOperations: BashOperations = {
  exec(command, cwd, { onData, signal, timeout, env }) {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd.exe" : "/bin/sh";
      const shellArgs = isWindows ? ["/c", command] : ["-c", command];

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timeoutId = setTimeout(() => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
        }, timeout);
      }

      const onAbort = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode: code });
      });

      child.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  },
};

export const bashTool = createBashTool(process.cwd());
