import * as posix from "node:path/posix";
import type { RemoteWorkspaceInfo, RemoteWorkspaceTarget } from "../types.ts";
import { quotePosix, sshErrorHint } from "./args.ts";
import { createPasswordSshTransport, preflightHostKey, resolveSshConfig } from "./password.ts";
import { createSshTransport, type SshTransport } from "./transport.ts";

export interface SshProbeOptions {
	path?: string;
	researchDir?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Password for password authentication. Key/agent auth is used when omitted. */
	password?: string;
	/** Inject a transport for tests. */
	transport?: SshTransport;
}

export interface SshProbe {
	info: RemoteWorkspaceInfo;
	pathExists: boolean;
	pathWritable: boolean;
	tools: Record<string, string | undefined>;
	transport: SshTransport;
}

export function expandRemotePath(input: string | undefined, home: string): string {
	if (!input || input === "~") return posix.normalize(home);
	if (input.includes("\0") || input.includes("\n") || input.includes("\r")) {
		throw new Error("Remote path contains invalid control characters");
	}
	if (input.startsWith("~/")) return posix.join(home, input.slice(2));
	if (!posix.isAbsolute(input)) throw new Error("Remote path must be absolute or start with ~/");
	return posix.normalize(input);
}

function parseProbe(stdout: string): Record<string, string> {
	const values: Record<string, string> = {};
	const lines = stdout.split(/\r?\n/);
	const start = lines.indexOf("SA_PROBE");
	if (start === -1) throw new Error(`Unexpected remote probe output: ${stdout.trim().slice(0, 500)}`);
	for (const line of lines.slice(start + 1)) {
		const index = line.indexOf("=");
		if (index <= 0) continue;
		values[line.slice(0, index)] = line.slice(index + 1);
	}
	return values;
}

const PROBE_SCRIPT = [
	"printf 'SA_PROBE\\n'",
	"printf 'system=%s\\n' \"$(uname -s 2>/dev/null)\"",
	"printf 'arch=%s\\n' \"$(uname -m 2>/dev/null)\"",
	"printf 'home=%s\\n' \"$HOME\"",
	"printf 'bash=%s\\n' \"$(command -v bash 2>/dev/null)\"",
	"printf 'sh=%s\\n' \"$(command -v sh 2>/dev/null)\"",
	"printf 'python=%s\\n' \"$(command -v python3 2>/dev/null || command -v python 2>/dev/null)\"",
	"printf 'rg=%s\\n' \"$(command -v rg 2>/dev/null)\"",
	"printf 'fd=%s\\n' \"$(command -v fd 2>/dev/null || command -v fdfind 2>/dev/null)\"",
	"printf 'git=%s\\n' \"$(command -v git 2>/dev/null)\"",
	"printf 'nvidia=%s\\n' \"$(command -v nvidia-smi 2>/dev/null)\"",
].join("\n");

export async function probeSshTarget(target: RemoteWorkspaceTarget, options: SshProbeOptions = {}): Promise<SshProbe> {
	let transport: SshTransport;
	let auth: "key" | "password" = "key";
	let resolvedUser = target.user;
	let resolvedPort = target.port;
	if (options.transport) {
		transport = options.transport;
	} else if (options.password !== undefined) {
		const config = await resolveSshConfig(target);
		const pin = await preflightHostKey(target);
		transport = createPasswordSshTransport(
			{ ...config, algorithm: pin.algorithm, fingerprint: pin.fingerprint },
			options.password,
		);
		auth = "password";
		resolvedUser = target.user ?? config.user;
		resolvedPort = target.port ?? config.port;
	} else {
		transport = createSshTransport(target);
	}
	const result = await transport.run(`sh -c ${quotePosix(PROBE_SCRIPT)}`, {
		timeoutMs: options.timeoutMs ?? 30_000,
		signal: options.signal,
	});
	if (result.code !== 0) {
		const stderr = result.stderr.toString("utf8").trim();
		throw new Error(
			result.timedOut
				? `SSH connection to ${target.host} timed out`
				: `SSH connection to ${target.host} failed${stderr ? `: ${stderr}` : ""}\n${sshErrorHint(stderr)}`,
		);
	}
	const values = parseProbe(result.stdout.toString("utf8"));
	const system = (values.system ?? "").trim();
	if (system !== "Linux" && system !== "Darwin") {
		throw new Error(
			`Remote host ${target.host} runs ${system || "an unknown system"}; only Linux and macOS are supported.`,
		);
	}
	const home = values.home?.trim();
	if (!home) throw new Error(`Could not determine the home directory on ${target.host}`);
	if (!values.bash && !values.sh) throw new Error(`Remote host ${target.host} has neither bash nor sh`);
	const path = expandRemotePath(options.path, home);
	const researchDir = expandRemotePath(options.researchDir ?? posix.join(path, "research", "workspace"), home);
	const checkScript = [
		`p=${quotePosix(path)}`,
		'if [ -e "$p" ]; then echo exists=1; else echo exists=0; fi',
		'if [ -d "$p" ]; then echo dir=1; else echo dir=0; fi',
		'if [ -w "$p" ]; then echo writable=1; else echo writable=0; fi',
	].join("\n");
	const check = await transport.run(`sh -c ${quotePosix(checkScript)}`, {
		timeoutMs: options.timeoutMs ?? 30_000,
		signal: options.signal,
	});
	if (check.code !== 0) {
		throw new Error(`Could not inspect ${path} on ${target.host}: ${check.stderr.toString("utf8").trim()}`);
	}
	const checkValues = Object.fromEntries(
		check.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.filter((line) => line.includes("="))
			.map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1)] as const;
			}),
	);
	const pathExists = checkValues.exists === "1";
	const isDirectory = checkValues.dir === "1";
	if (pathExists && !isDirectory) throw new Error(`Remote workspace path is not a directory: ${path}`);
	const info: RemoteWorkspaceInfo = {
		...target,
		user: resolvedUser,
		port: resolvedPort,
		home,
		workspacePath: path,
		researchDir,
		platform: system === "Darwin" ? "darwin" : "linux",
		arch: (values.arch ?? "").trim() || "unknown",
		loginShell: values.bash ? "bash" : "sh",
		auth,
	};
	return {
		info,
		pathExists,
		pathWritable: checkValues.writable === "1",
		tools: {
			python: values.python?.trim() || undefined,
			rg: values.rg?.trim() || undefined,
			fd: values.fd?.trim() || undefined,
			git: values.git?.trim() || undefined,
			nvidia: values.nvidia?.trim() || undefined,
		},
		transport,
	};
}

export async function ensureRemoteDirectory(
	transport: SshTransport,
	path: string,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
	const script = `mkdir -p ${quotePosix(path)}`;
	const result = await transport.run(`sh -c ${quotePosix(script)}`, {
		timeoutMs: options.timeoutMs ?? 30_000,
		signal: options.signal,
	});
	if (result.code !== 0) {
		throw new Error(`Could not create remote directory ${path}: ${result.stderr.toString("utf8").trim()}`);
	}
}
