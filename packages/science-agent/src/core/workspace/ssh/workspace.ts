import { mkdir, writeFile } from "node:fs/promises";
import { dirname as nativeDirname } from "node:path";
import * as posix from "node:path/posix";
import { minimatch } from "minimatch";
import type {
	RemoteWorkspaceInfo,
	ToolWorkspace,
	WorkspaceExecOptions,
	WorkspaceExecResult,
	WorkspaceGlobOptions,
	WorkspaceGrepMatch,
	WorkspaceGrepOptions,
	WorkspaceInfo,
	WorkspaceRemoveOptions,
	WorkspaceStat,
} from "../types.ts";
import { quotePosix, sshDisplay } from "./args.ts";
import { expandRemotePath } from "./probe.ts";
import type { SshRunResult, SshTransport } from "./transport.ts";

const FILE_TIMEOUT_MS = 120_000;
const LARGE_TIMEOUT_MS = 300_000;

function imageMimeType(path: string): string | null {
	const extension = posix.extname(path).toLowerCase();
	if (extension === ".png") return "image/png";
	if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
	if (extension === ".gif") return "image/gif";
	if (extension === ".webp") return "image/webp";
	if (extension === ".bmp") return "image/bmp";
	return null;
}

function gitignoreFilter(relative: string, ignore: string[]): boolean {
	return ignore.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

export class SshWorkspace implements ToolWorkspace {
	readonly info: WorkspaceInfo;
	readonly path: typeof posix;
	private readonly transport: SshTransport;
	private readonly remote: RemoteWorkspaceInfo;

	constructor(remote: RemoteWorkspaceInfo, transport: SshTransport) {
		this.remote = remote;
		this.transport = transport;
		this.path = posix;
		this.info = {
			kind: "ssh",
			cwd: remote.workspacePath,
			display: sshDisplay(remote, remote.workspacePath),
			remote,
		};
	}

	get remoteInfo(): RemoteWorkspaceInfo {
		return this.remote;
	}

	resolvePath(input: string): string {
		if (input === "" || input === ".") return this.info.cwd;
		if (input === "~" || input.startsWith("~/")) return expandRemotePath(input, this.remote.home);
		if (posix.isAbsolute(input)) return posix.normalize(input);
		return posix.normalize(posix.join(this.info.cwd, input));
	}

	private cwdPrefix(cwd?: string): string {
		const dir = cwd ?? this.info.cwd;
		return `cd ${quotePosix(dir)} 2>/dev/null || { printf 'Working directory does not exist: %s\\n' ${quotePosix(dir)} >&2; exit 1; }\n`;
	}

	private async run(script: string, options: WorkspaceExecOptions = {}): Promise<SshRunResult> {
		const full = `${this.cwdPrefix(options.cwd)}${script}`;
		return this.transport.run(`sh -c ${quotePosix(full)}`, {
			stdin: options.stdin,
			timeoutMs: options.timeoutMs ?? FILE_TIMEOUT_MS,
			signal: options.signal,
			onStdout: options.onData,
			onStderr: options.onData,
		});
	}

	private async runLogin(
		script: string,
		options: WorkspaceExecOptions = {},
		timeoutMs = FILE_TIMEOUT_MS,
	): Promise<SshRunResult> {
		return this.transport.run(`${this.remote.loginShell} -lc ${quotePosix(script)}`, {
			stdin: options.stdin,
			timeoutMs: options.timeoutMs ?? timeoutMs,
			signal: options.signal,
			onStdout: options.onData,
			onStderr: options.onData,
		});
	}

	private check(result: SshRunResult, action: string): void {
		if (result.aborted) throw new Error("Operation aborted");
		if (result.timedOut) throw new Error(`${action} timed out`);
		if (result.code !== 0) {
			const stderr = result.stderr.toString("utf8").trim();
			throw new Error(`${action} failed${stderr ? `: ${stderr}` : ` with exit code ${result.code ?? "unknown"}`}`);
		}
	}

	async readFile(path: string): Promise<Buffer> {
		const result = await this.transport.run(`sh -c ${quotePosix(`cat ${quotePosix(path)}`)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
			maxOutputBytes: 256 * 1024 * 1024,
		});
		this.check(result, `Reading ${path}`);
		return result.stdout;
	}

	async readText(path: string): Promise<string> {
		return (await this.readFile(path)).toString("utf8");
	}

	async writeFile(path: string, content: string | Buffer): Promise<void> {
		const script = `mkdir -p ${quotePosix(posix.dirname(path))} && cat > ${quotePosix(path)}`;
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, {
			stdin: content,
			timeoutMs: LARGE_TIMEOUT_MS,
			maxOutputBytes: 4 * 1024 * 1024,
		});
		this.check(result, `Writing ${path}`);
	}

	async access(path: string, mode: "r" | "w" | "rw"): Promise<void> {
		const tests = mode === "r" ? "-r" : mode === "w" ? "-w" : "-r";
		const extra = mode === "rw" ? ` && test -w ${quotePosix(path)}` : "";
		const result = await this.transport.run(`sh -c ${quotePosix(`test ${tests} ${quotePosix(path)}${extra}`)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
		});
		this.check(result, `Accessing ${path}`);
	}

	async mkdir(path: string): Promise<void> {
		const result = await this.transport.run(`sh -c ${quotePosix(`mkdir -p ${quotePosix(path)}`)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
		});
		this.check(result, `Creating ${path}`);
	}

	async exists(path: string): Promise<boolean> {
		const result = await this.transport.run(`sh -c ${quotePosix(`test -e ${quotePosix(path)}`)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
		});
		if (result.aborted) throw new Error("Operation aborted");
		if (result.timedOut) throw new Error(`Checking ${path} timed out`);
		if (result.code !== 0 && result.code !== 1) {
			throw new Error(`Checking ${path} failed: ${result.stderr.toString("utf8").trim()}`);
		}
		return result.code === 0;
	}

	async stat(path: string): Promise<WorkspaceStat> {
		const script = [
			`p=${quotePosix(path)}`,
			'[ -e "$p" ] || { printf "Path not found: %s\\n" "$p" >&2; exit 1; }',
			'if [ -d "$p" ]; then d=1; else d=0; fi',
			'if [ -f "$p" ]; then s=$(wc -c < "$p"); else s=0; fi',
			'm=$(stat -c %Y "$p" 2>/dev/null || stat -f %m "$p" 2>/dev/null || echo 0)',
			'printf \'%s %s %s\\n\' "$d" "$s" "$m"',
		].join("\n");
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, { timeoutMs: FILE_TIMEOUT_MS });
		this.check(result, `Inspecting ${path}`);
		const [directory, size, mtime] = result.stdout.toString("utf8").trim().split(/\s+/);
		const mtimeSeconds = Number.parseInt(mtime ?? "0", 10);
		return {
			isDirectory: () => directory === "1",
			size: Number.parseInt(size ?? "0", 10) || 0,
			mtimeMs: Number.isFinite(mtimeSeconds) ? mtimeSeconds * 1000 : 0,
		};
	}

	async readdir(path: string): Promise<string[]> {
		const script = [
			`cd ${quotePosix(path)} || { printf "Cannot read directory: %s\\n" ${quotePosix(path)} >&2; exit 1; }`,
			"for f in .[!.]* ..?* *; do",
			'  [ -e "$f" ] || [ -L "$f" ] || continue',
			"  printf '%s\\0' \"$f\"",
			"done",
		].join("\n");
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
			maxOutputBytes: 16 * 1024 * 1024,
		});
		this.check(result, `Listing ${path}`);
		return result.stdout
			.toString("utf8")
			.split("\0")
			.filter((entry) => entry !== "");
	}

	async remove(path: string, options?: WorkspaceRemoveOptions): Promise<void> {
		const flag = options?.recursive ? "-rf" : "-f";
		const result = await this.transport.run(`sh -c ${quotePosix(`rm ${flag} ${quotePosix(path)}`)}`, {
			timeoutMs: FILE_TIMEOUT_MS,
		});
		this.check(result, `Removing ${path}`);
	}

	async move(from: string, to: string): Promise<void> {
		const script = `mkdir -p ${quotePosix(posix.dirname(to))} && mv ${quotePosix(from)} ${quotePosix(to)}`;
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, { timeoutMs: FILE_TIMEOUT_MS });
		this.check(result, `Moving ${from}`);
	}

	async copy(from: string, to: string): Promise<void> {
		const script = `mkdir -p ${quotePosix(posix.dirname(to))} && cp -R ${quotePosix(from)} ${quotePosix(to)}`;
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, { timeoutMs: LARGE_TIMEOUT_MS });
		this.check(result, `Copying ${from}`);
	}

	async detectImageMimeType(path: string): Promise<string | null | undefined> {
		return imageMimeType(path);
	}

	async glob(pattern: string, cwd: string, options: WorkspaceGlobOptions): Promise<string[]> {
		const script = [
			`cd ${quotePosix(cwd)} || exit 1`,
			"if command -v rg >/dev/null 2>&1; then",
			"  rg --files --hidden --null -g '!**/.git/**' 2>/dev/null",
			"elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then",
			"  git ls-files -z --cached --others --exclude-standard 2>/dev/null",
			"else",
			"  find . -type f -print0 2>/dev/null",
			"fi",
		].join("\n");
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, {
			timeoutMs: LARGE_TIMEOUT_MS,
			maxOutputBytes: 32 * 1024 * 1024,
		});
		if (result.aborted) throw new Error("Operation aborted");
		if (result.timedOut) throw new Error("Finding files timed out");
		if (result.code !== 0 && result.stdout.length === 0) {
			const stderr = result.stderr.toString("utf8").trim();
			if (stderr) throw new Error(`Finding files failed: ${stderr}`);
			return [];
		}
		const matchBase = !pattern.includes("/");
		const seen = new Set<string>();
		const output: string[] = [];
		for (const raw of result.stdout.toString("utf8").split("\0")) {
			const relative = raw.replace(/^\.\//, "");
			if (!relative || seen.has(relative) || gitignoreFilter(relative, options.ignore)) continue;
			if (relative === ".git" || relative.startsWith(".git/") || relative.includes("/.git/")) continue;
			if (!minimatch(relative, pattern, { dot: true, matchBase })) continue;
			seen.add(relative);
			output.push(relative);
			if (output.length >= options.limit) break;
		}
		return output;
	}

	async grep(options: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]> {
		const searchPath = options.path;
		const rgFlags = [
			"--no-config",
			"--json",
			"--line-number",
			"--color=never",
			"--hidden",
			`--glob ${quotePosix("!**/.git/**")}`,
			`--glob ${quotePosix("!**/node_modules/**")}`,
			options.ignoreCase ? "--ignore-case" : undefined,
			options.literal ? "--fixed-strings" : undefined,
			options.glob ? `--glob ${quotePosix(options.glob)}` : undefined,
		]
			.filter((flag): flag is string => Boolean(flag))
			.join(" ");
		const grepFlags = [
			"-r",
			"-n",
			"-I",
			"-H",
			"--exclude-dir=.git",
			"--exclude-dir=node_modules",
			options.ignoreCase ? "-i" : undefined,
			options.literal ? "-F" : undefined,
			options.glob ? `--include=${quotePosix(options.glob)}` : undefined,
		]
			.filter((flag): flag is string => Boolean(flag))
			.join(" ");
		const script = [
			`p=${quotePosix(searchPath)}`,
			'if [ -d "$p" ]; then root="$p"; target="."; cd "$p" || exit 1;',
			'elif [ -f "$p" ]; then root=$(dirname "$p"); target=$(basename "$p"); cd "$root" || exit 1;',
			'else printf "Path not found: %s\\n" "$p" >&2; exit 1; fi',
			"if command -v rg >/dev/null 2>&1; then",
			"  printf 'SA_GREP_MODE=rg\\n'",
			`  rg ${rgFlags} -- ${quotePosix(options.pattern)} "$target"`,
			"else",
			"  printf 'SA_GREP_MODE=grep\\n'",
			`  grep ${grepFlags} -- ${quotePosix(options.pattern)} "$target"`,
			"fi",
			"printf 'SA_GREP_ROOT=%s\\n' \"$root\"",
		].join("\n");
		const result = await this.transport.run(`sh -c ${quotePosix(script)}`, {
			timeoutMs: LARGE_TIMEOUT_MS,
			signal: options.signal,
			maxOutputBytes: 64 * 1024 * 1024,
		});
		if (result.aborted) throw new Error("Operation aborted");
		if (result.timedOut) throw new Error("Search timed out");
		const text = result.stdout.toString("utf8");
		let mode = "";
		let root = searchPath;
		const matches: WorkspaceGrepMatch[] = [];
		for (const raw of text.split(/\r?\n/)) {
			if (!raw) continue;
			if (raw.startsWith("SA_GREP_MODE=")) {
				mode = raw.slice("SA_GREP_MODE=".length);
				continue;
			}
			if (raw.startsWith("SA_GREP_ROOT=")) {
				root = raw.slice("SA_GREP_ROOT=".length);
				continue;
			}
			if (mode === "rg") {
				try {
					const event = JSON.parse(raw) as {
						type?: string;
						data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
					};
					if (event.type !== "match") continue;
					const filePath = event.data?.path?.text;
					const lineNumber = event.data?.line_number;
					if (!filePath || typeof lineNumber !== "number") continue;
					const absolute = posix.isAbsolute(filePath) ? filePath : posix.resolve(root, filePath);
					matches.push({
						filePath: absolute,
						lineNumber,
						lineText: event.data?.lines?.text?.replace(/\r?\n$/, ""),
					});
				} catch {
					// Ignore non-JSON diagnostics.
				}
			} else if (mode === "grep") {
				const match = /^(.*?):(\d+):(.*)$/.exec(raw);
				if (!match) continue;
				const filePath = match[1]!;
				const absolute = posix.isAbsolute(filePath) ? filePath : posix.resolve(root, filePath);
				matches.push({ filePath: absolute, lineNumber: Number.parseInt(match[2]!, 10), lineText: match[3] });
			}
			if (matches.length >= options.limit) break;
		}
		if (result.code !== 0 && result.code !== 1 && matches.length === 0) {
			const stderr = result.stderr.toString("utf8").trim();
			throw new Error(`Search failed${stderr ? `: ${stderr}` : ` with exit code ${result.code ?? "unknown"}`}`);
		}
		return matches.slice(0, options.limit);
	}

	/** Run a shell script through the remote login shell, streaming merged output. Used by the bash tool. */
	async runBashScript(script: string, options: WorkspaceExecOptions = {}): Promise<SshRunResult> {
		const full = `${this.cwdPrefix(options.cwd)}${script}`;
		return this.transport.run(`${this.remote.loginShell} -l`, {
			stdin: full,
			timeoutMs: options.timeoutMs ?? 0,
			signal: options.signal,
			onStdout: options.onData,
			onStderr: options.onData,
		});
	}

	async exec(command: string, args: string[], options: WorkspaceExecOptions = {}): Promise<WorkspaceExecResult> {
		const lines = [this.cwdPrefix(options.cwd).trimEnd()];
		for (const [key, value] of Object.entries(options.env ?? {})) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				throw new Error(`Invalid environment variable name: ${key}`);
			}
			lines.push(`export ${key}=${quotePosix(value)}`);
		}
		lines.push(`exec ${quotePosix(command)}${args.map((arg) => ` ${quotePosix(arg)}`).join("")}`);
		const result = await this.runLogin(lines.join("\n"), options, options.timeoutMs);
		return {
			exitCode: result.code,
			stdout: result.stdout.toString("utf8"),
			stderr: result.stderr.toString("utf8"),
			timedOut: result.timedOut,
			aborted: result.aborted,
		};
	}

	async downloadToLocal(remotePath: string, localPath: string, signal?: AbortSignal): Promise<void> {
		const result = await this.transport.run(`sh -c ${quotePosix(`cat ${quotePosix(remotePath)}`)}`, {
			timeoutMs: LARGE_TIMEOUT_MS,
			signal,
			maxOutputBytes: 256 * 1024 * 1024,
		});
		this.check(result, `Downloading ${remotePath}`);
		await mkdir(nativeDirname(localPath), { recursive: true });
		await writeFile(localPath, result.stdout);
	}

	async dispose(): Promise<void> {
		await this.transport.dispose?.();
	}
}
