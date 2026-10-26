import { constants, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { minimatch } from "minimatch";
import { spawnProcess } from "../../utils/child-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import { resolvePath as resolveLocalPath } from "../../utils/paths.ts";
import type {
	ToolWorkspace,
	WorkspaceExecOptions,
	WorkspaceExecResult,
	WorkspaceGlobOptions,
	WorkspaceGrepMatch,
	WorkspaceGrepOptions,
	WorkspaceInfo,
	WorkspaceStat,
} from "./types.ts";

async function walkFiles(root: string, relative: string, ignore: string[], output: string[]): Promise<void> {
	const current = relative ? nodePath.join(root, relative) : root;
	const entries = await readdir(current, { withFileTypes: true });
	for (const entry of entries) {
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		if (ignore.some((pattern) => minimatch(rel, pattern, { dot: true }))) continue;
		if (entry.isDirectory()) {
			await walkFiles(root, rel, ignore, output);
		} else if (entry.isFile()) {
			output.push(rel);
		}
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class LocalWorkspace implements ToolWorkspace {
	readonly info: WorkspaceInfo;
	readonly path: typeof nodePath.posix;

	constructor(cwd: string) {
		this.info = { kind: "local", cwd: nodePath.resolve(cwd), display: nodePath.resolve(cwd) };
		this.path = nodePath;
	}

	resolvePath(input: string): string {
		return resolveLocalPath(input, this.info.cwd);
	}

	async readFile(path: string): Promise<Buffer> {
		return readFile(path);
	}

	async readText(path: string): Promise<string> {
		return readFile(path, "utf8");
	}

	async writeFile(path: string, content: string | Buffer): Promise<void> {
		await writeFile(path, content);
	}

	async access(path: string, mode: "r" | "w" | "rw"): Promise<void> {
		const flag = mode === "r" ? constants.R_OK : mode === "w" ? constants.W_OK : constants.R_OK | constants.W_OK;
		const { access } = await import("node:fs/promises");
		await access(path, flag);
	}

	async mkdir(path: string): Promise<void> {
		await mkdir(path, { recursive: true });
	}

	async exists(path: string): Promise<boolean> {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	}

	async stat(path: string): Promise<WorkspaceStat> {
		const value = await stat(path);
		return {
			isDirectory: () => value.isDirectory(),
			size: value.isDirectory() ? 0 : value.size,
			mtimeMs: value.mtimeMs,
		};
	}

	async readdir(path: string): Promise<string[]> {
		return readdir(path);
	}

	async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
		const { rm } = await import("node:fs/promises");
		await rm(path, { recursive: options?.recursive === true, force: false });
	}

	async move(from: string, to: string): Promise<void> {
		const { rename } = await import("node:fs/promises");
		await rename(from, to);
	}

	async copy(from: string, to: string): Promise<void> {
		const { cp } = await import("node:fs/promises");
		await cp(from, to, { recursive: true });
	}

	async detectImageMimeType(path: string): Promise<string | null | undefined> {
		return detectSupportedImageMimeTypeFromFile(path);
	}

	async glob(pattern: string, cwd: string, options: WorkspaceGlobOptions): Promise<string[]> {
		const files: string[] = [];
		await walkFiles(cwd, "", options.ignore, files);
		const matchBase = !pattern.includes("/");
		return files.filter((file) => minimatch(file, pattern, { dot: true, matchBase })).slice(0, options.limit);
	}

	async grep(options: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]> {
		const characterPattern = options.literal ? escapeRegExp(options.pattern) : options.pattern;
		let regex: RegExp;
		try {
			regex = new RegExp(characterPattern, options.ignoreCase ? "i" : "");
		} catch {
			regex = new RegExp(escapeRegExp(options.pattern), options.ignoreCase ? "i" : "");
		}
		const targetStat = await stat(options.path);
		const files: string[] = [];
		if (targetStat.isDirectory()) {
			const relative: string[] = [];
			await walkFiles(options.path, "", ["**/.git/**", "**/node_modules/**"], relative);
			files.push(...relative.map((file) => nodePath.join(options.path, file)));
		} else {
			files.push(options.path);
		}
		const matchBase = options.glob ? !options.glob.includes("/") : false;
		const matches: WorkspaceGrepMatch[] = [];
		for (const file of files) {
			if (options.signal?.aborted) throw new Error("Operation aborted");
			if (options.glob && !minimatch(nodePath.basename(file), options.glob, { dot: true, matchBase })) continue;
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				continue;
			}
			if (text.includes("\0")) continue;
			const lines = text.split(/\r?\n/);
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index]!;
				if (regex.test(line)) {
					matches.push({ filePath: file, lineNumber: index + 1, lineText: line });
					if (matches.length >= options.limit) return matches;
				}
			}
		}
		return matches;
	}

	exec(command: string, args: string[], options: WorkspaceExecOptions = {}): Promise<WorkspaceExecResult> {
		return new Promise((resolve) => {
			const child = spawnProcess(command, args, {
				cwd: options.cwd ?? this.info.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...(options.env ?? {}) },
			});
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let settled = false;
			let timedOut = false;
			let aborted = false;
			const timer = options.timeoutMs
				? setTimeout(() => {
						timedOut = true;
						child.kill();
					}, options.timeoutMs)
				: undefined;
			const onAbort = () => {
				aborted = true;
				child.kill();
			};
			options.signal?.addEventListener("abort", onAbort, { once: true });
			const finish = (exitCode: number | null) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
				resolve({
					exitCode,
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					timedOut,
					aborted,
				});
			};
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout.push(chunk);
				options.onData?.(chunk);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr.push(chunk);
				options.onData?.(chunk);
			});
			child.on("error", (error) => {
				stderr.push(Buffer.from(error.message));
				finish(null);
			});
			child.on("close", (code) => finish(code));
			child.stdin?.on("error", () => {});
			child.stdin?.end(options.stdin ?? "");
		});
	}

	async downloadToLocal(remotePath: string, localPath: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new Error("Operation aborted");
		await mkdir(nodePath.dirname(localPath), { recursive: true });
		await copyFile(remotePath, localPath);
	}

	async dispose(): Promise<void> {}
}

export function createLocalWorkspace(cwd: string): ToolWorkspace {
	return new LocalWorkspace(cwd);
}
