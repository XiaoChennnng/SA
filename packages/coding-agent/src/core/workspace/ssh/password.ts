import { createHash } from "node:crypto";
import ssh2, { type ClientChannel, type Client as Ssh2Client } from "ssh2";
import { spawnProcess } from "../../../utils/child-process.ts";
import type { RemoteWorkspaceTarget } from "../types.ts";
import { sshErrorHint, validateSshTarget } from "./args.ts";
import type { SshRunOptions, SshRunResult, SshTransport } from "./transport.ts";

const PROCESS_TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT = 2 * 1024 * 1024;
const { Client } = ssh2;

interface ProcessResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

function runSshProcess(command: string, args: string[], timeoutMs = PROCESS_TIMEOUT_MS): Promise<ProcessResult> {
	return new Promise((resolve) => {
		const child = spawnProcess(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		let timedOut = false;
		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				timedOut,
			});
		};
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
			finish(null);
		}, timeoutMs);
		const append = (chunks: Buffer[], chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes <= MAX_PROCESS_OUTPUT) chunks.push(chunk);
		};
		child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk));
		child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk));
		child.on("error", (error) => {
			stderr.push(Buffer.from(error.message));
			finish(null);
		});
		child.on("close", (code) => finish(code));
	});
}

export interface ResolvedSshConfig {
	hostname: string;
	user: string;
	port: number;
}

/** Resolve ~/.ssh/config aliases and reject features ssh2 cannot traverse. */
export async function resolveSshConfig(target: RemoteWorkspaceTarget): Promise<ResolvedSshConfig> {
	validateSshTarget(target);
	const args = ["-G"];
	if (target.user !== undefined) args.push("-l", target.user);
	if (target.port !== undefined) args.push("-p", String(target.port));
	args.push("--", target.host);
	const result = await runSshProcess(target.sshCommand ?? "ssh", args);
	if (result.code !== 0) {
		throw new Error(
			`Could not resolve SSH configuration for ${target.host}: ${
				result.stderr.trim() || (result.timedOut ? "ssh -G timed out" : `ssh exited with ${result.code}`)
			}`,
		);
	}
	const values = new Map<string, string>();
	for (const line of result.stdout.split(/\r?\n/)) {
		const index = line.indexOf(" ");
		if (index <= 0) continue;
		values.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
	}
	const proxyJump = values.get("proxyjump");
	const proxyCommand = values.get("proxycommand");
	if ((proxyJump && proxyJump !== "none") || (proxyCommand && proxyCommand !== "none")) {
		throw new Error(
			"Password authentication requires a direct SSH host; ProxyJump and ProxyCommand are not supported. Use key authentication or enter the final host directly.",
		);
	}
	const hostname = values.get("hostname")?.trim() || target.host;
	const user = values.get("user")?.trim() || target.user;
	const port = Number.parseInt(values.get("port") ?? String(target.port ?? 22), 10);
	if (!hostname || /\s|[\x00-\x1f\x7f]/.test(hostname)) {
		throw new Error(`Invalid resolved SSH hostname: ${JSON.stringify(hostname)}`);
	}
	if (!user) throw new Error(`Could not resolve an SSH user for ${target.host}`);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid resolved SSH port: ${values.get("port")}`);
	}
	return { hostname, user, port };
}

export interface HostKeyPin {
	algorithm: string;
	fingerprint: string;
}

export function parseHostKeyPin(stderr: string): HostKeyPin | undefined {
	let pin: HostKeyPin | undefined;
	for (const match of stderr.matchAll(/Server host key: (\S+) (SHA256:[A-Za-z0-9+/=]+)/g)) {
		pin = { algorithm: match[1]!, fingerprint: match[2]!.replace(/=+$/, "") };
	}
	return pin;
}

/** Verify the host key with OpenSSH and capture its fingerprint before ssh2 connects. */
export async function preflightHostKey(target: RemoteWorkspaceTarget): Promise<HostKeyPin> {
	validateSshTarget(target);
	const args = [
		"-v",
		"-T",
		"-a",
		"-x",
		"-o",
		"BatchMode=yes",
		"-o",
		"StrictHostKeyChecking=yes",
		"-o",
		"ConnectTimeout=15",
		"-o",
		"ServerAliveInterval=15",
	];
	if (target.user !== undefined) args.push("-l", target.user);
	if (target.port !== undefined) args.push("-p", String(target.port));
	args.push("--", target.host, "true");
	const result = await runSshProcess(target.sshCommand ?? "ssh", args);
	const stderr = result.stderr;
	if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .* host key is known/i.test(stderr)) {
		throw new Error(`Host key verification failed for ${target.host}. ${sshErrorHint(stderr)}`);
	}
	const pin = parseHostKeyPin(stderr);
	if (!pin) {
		throw new Error(
			`Could not verify the host key of ${target.host}. ${
				result.timedOut ? "The connection timed out." : sshErrorHint(stderr)
			}${stderr.trim() ? `\n${stderr.trim().slice(-1500)}` : ""}`,
		);
	}
	return pin;
}

export interface PasswordSshTarget extends ResolvedSshConfig {
	algorithm: string;
	fingerprint: string;
}

export async function preparePasswordSsh(
	target: RemoteWorkspaceTarget,
	password: string,
): Promise<{ transport: SshTransport; resolved: PasswordSshTarget }> {
	const config = await resolveSshConfig(target);
	const pin = await preflightHostKey(target);
	const resolved: PasswordSshTarget = { ...config, algorithm: pin.algorithm, fingerprint: pin.fingerprint };
	return { transport: createPasswordSshTransport(resolved, password), resolved };
}

function isAuthFailure(message: string): boolean {
	return /authentication methods failed|authentication failed|permission denied/i.test(message);
}

function isHostKeyFailure(message: string): boolean {
	return /host denied|verification failed|host key/i.test(message);
}

export function createPasswordSshTransport(target: PasswordSshTarget, password: string): SshTransport {
	let client: Ssh2Client | null = null;
	let pending: Promise<Ssh2Client> | null = null;

	const connect = (): Promise<Ssh2Client> => {
		if (client) return Promise.resolve(client);
		if (pending) return pending;
		pending = new Promise<Ssh2Client>((resolve, reject) => {
			const candidate = new Client();
			let settled = false;
			const fail = (error: Error) => {
				if (!settled) {
					settled = true;
					pending = null;
					reject(error);
				} else if (client === candidate) {
					client = null;
				}
			};
			const message = (error: Error) => {
				if (isAuthFailure(error.message)) {
					return `Password authentication failed for ${target.user}@${target.hostname}. Check the password, or use key authentication.`;
				}
				if (isHostKeyFailure(error.message)) {
					return `Host key verification failed for ${target.hostname}. The host key may have changed.`;
				}
				return error.message;
			};
			candidate.on("ready", () => {
				settled = true;
				pending = null;
				client = candidate;
				resolve(candidate);
			});
			candidate.on("error", (error: Error) => fail(new Error(message(error))));
			candidate.on("close", () => {
				if (client === candidate) client = null;
			});
			candidate.on(
				"keyboard-interactive",
				(
					_name: string,
					_instructions: string,
					_language: string,
					prompts: unknown[],
					finish: (answers: string[]) => void,
				) => {
					finish(prompts.map(() => password));
				},
			);
			try {
				candidate.connect({
					host: target.hostname,
					port: target.port,
					username: target.user,
					password,
					tryKeyboard: true,
					readyTimeout: 30_000,
					keepaliveInterval: 15_000,
					keepaliveCountMax: 3,
					algorithms: { serverHostKey: [target.algorithm] },
					hostVerifier: (key: Buffer, verify: (permitted: boolean) => void) => {
						const fingerprint = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
						verify(fingerprint === target.fingerprint);
					},
				});
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		return pending;
	};

	return {
		async run(remoteCommand: string, options: SshRunOptions = {}): Promise<SshRunResult> {
			if (options.signal?.aborted) {
				return {
					code: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.from("Operation aborted"),
					timedOut: false,
					aborted: true,
				};
			}
			let active: Ssh2Client;
			try {
				active = await connect();
			} catch (error) {
				return {
					code: null,
					stdout: Buffer.alloc(0),
					stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
					timedOut: false,
					aborted: false,
				};
			}
			return new Promise<SshRunResult>((resolve) => {
				let settled = false;
				let timedOut = false;
				let aborted = false;
				let overflowed = false;
				let outputBytes = 0;
				const stdout: Buffer[] = [];
				const stderr: Buffer[] = [];
				let timer: NodeJS.Timeout | undefined;
				let channel: ClientChannel | undefined;
				let exitCode: number | null = null;
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
					channel?.close();
					finish(null);
				};
				options.signal?.addEventListener("abort", onAbort, { once: true });
				active.exec(remoteCommand, (error: Error | undefined, stream: ClientChannel) => {
					if (error) {
						stderr.push(Buffer.from(error.message));
						finish(null);
						return;
					}
					channel = stream;
					stream.on("data", (chunk: Buffer) => {
						outputBytes += chunk.length;
						if (outputBytes > (options.maxOutputBytes ?? 64 * 1024 * 1024)) {
							if (!overflowed) {
								overflowed = true;
								stderr.push(Buffer.from("\nSSH output limit exceeded; the command was stopped.\n"));
							}
							stream.close();
							finish(null);
							return;
						}
						stdout.push(chunk);
						options.onStdout?.(chunk);
					});
					stream.stderr.on("data", (chunk: Buffer) => {
						outputBytes += chunk.length;
						if (outputBytes > (options.maxOutputBytes ?? 64 * 1024 * 1024)) {
							if (!overflowed) {
								overflowed = true;
								stderr.push(Buffer.from("\nSSH output limit exceeded; the command was stopped.\n"));
							}
							stream.close();
							finish(null);
							return;
						}
						stderr.push(chunk);
						options.onStderr?.(chunk);
					});
					stream.on("exit", (code: number | null) => {
						exitCode = code ?? null;
					});
					stream.on("close", () => finish(exitCode));
					stream.on("error", (streamError: Error) => {
						stderr.push(Buffer.from(streamError.message));
						finish(null);
					});
					const timeoutMs = options.timeoutMs ?? 0;
					if (timeoutMs > 0) {
						timer = setTimeout(() => {
							timedOut = true;
							stream.close();
							finish(null);
						}, timeoutMs);
					}
					stream.stdin.on("error", () => {});
					stream.stdin.end(options.stdin ?? "");
				});
			});
		},
		async dispose() {
			client?.end();
			client = null;
			pending = null;
		},
	};
}
