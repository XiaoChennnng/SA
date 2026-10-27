import { spawnProcess } from "../../../utils/child-process.ts";
import type { RemoteWorkspaceTarget } from "../types.ts";
import { buildSshArgs } from "./args.ts";

export interface SshRunOptions {
	stdin?: string | Buffer;
	timeoutMs?: number;
	signal?: AbortSignal;
	onStdout?: (chunk: Buffer) => void;
	onStderr?: (chunk: Buffer) => void;
	maxOutputBytes?: number;
}

export interface SshRunResult {
	code: number | null;
	stdout: Buffer;
	stderr: Buffer;
	timedOut: boolean;
	aborted: boolean;
}

export interface SshTransport {
	run(remoteCommand: string, options?: SshRunOptions): Promise<SshRunResult>;
	dispose?(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function createSshTransport(target: RemoteWorkspaceTarget): SshTransport {
	return {
		run(remoteCommand, options = {}) {
			return new Promise((resolve) => {
				const args = [...buildSshArgs(target), remoteCommand];
				const child = spawnProcess(target.sshCommand ?? "ssh", args, {
					stdio: ["pipe", "pipe", "pipe"],
					windowsHide: true,
				});
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let outputBytes = 0;
				let settled = false;
				let timedOut = false;
				let aborted = false;
				let overflowed = false;
				const finish = (code: number | null) => {
					if (settled) return;
					settled = true;
					if (timer) clearTimeout(timer);
					options.signal?.removeEventListener("abort", onAbort);
					resolve({
						code,
						stdout: Buffer.concat(stdout),
						stderr: Buffer.concat(stderr),
						timedOut,
						aborted,
					});
				};
				const onAbort = () => {
					aborted = true;
					child.kill();
				};
				const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
				const timer =
					timeoutMs > 0
						? setTimeout(() => {
								timedOut = true;
								child.kill();
							}, timeoutMs)
						: undefined;
				options.signal?.addEventListener("abort", onAbort, { once: true });
				if (options.signal?.aborted) onAbort();
				const append = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr") => {
					outputBytes += chunk.length;
					if (outputBytes > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
						if (!overflowed) {
							overflowed = true;
							stderr.push(Buffer.from("\nSSH output limit exceeded; the command was stopped.\n"));
						}
						if (!child.killed) child.kill();
						return;
					}
					chunks.push(chunk);
					if (stream === "stdout") options.onStdout?.(chunk);
					else options.onStderr?.(chunk);
				};
				child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk, "stdout"));
				child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk, "stderr"));
				child.on("error", (error) => {
					stderr.push(Buffer.from(error.message));
					finish(null);
				});
				child.on("close", (code) => finish(code));
				child.stdin?.on("error", () => {});
				child.stdin?.end(options.stdin ?? "");
			});
		},
		async dispose() {},
	};
}
