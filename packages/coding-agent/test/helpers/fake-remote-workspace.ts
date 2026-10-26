import { mkdir, writeFile } from "node:fs/promises";
import { dirname as localDirname } from "node:path";
import * as posix from "node:path/posix";
import { minimatch } from "minimatch";
import type {
	ToolWorkspace,
	WorkspaceExecOptions,
	WorkspaceExecResult,
	WorkspaceGlobOptions,
	WorkspaceGrepMatch,
	WorkspaceGrepOptions,
	WorkspaceInfo,
	WorkspaceRemoveOptions,
	WorkspaceStat,
} from "../../src/core/workspace/types.ts";

export type FakeExecHandler = (
	command: string,
	args: string[],
	options: WorkspaceExecOptions,
) => Promise<WorkspaceExecResult>;

export class FakeRemoteWorkspace implements ToolWorkspace {
	readonly path = posix;
	readonly info: WorkspaceInfo = {
		kind: "ssh",
		cwd: "/work",
		display: "tester@host:/work",
		remote: {
			host: "host",
			user: "tester",
			home: "/home/tester",
			workspacePath: "/work",
			researchDir: "/work/research",
			platform: "linux",
			arch: "x64",
			loginShell: "bash",
		},
	};
	readonly files = new Map<string, Buffer>();
	readonly directories = new Set<string>(["/", "/work", "/work/research"]);
	execHandler?: FakeExecHandler;

	resolvePath(input: string): string {
		if (!input || input === ".") return this.info.cwd;
		if (input === "~" || input.startsWith("~/")) return posix.join("/home/tester", input.slice(1));
		if (posix.isAbsolute(input)) return posix.normalize(input);
		return posix.normalize(posix.join(this.info.cwd, input));
	}

	private ensureDirectory(path: string): void {
		let current = path;
		for (;;) {
			this.directories.add(current);
			const parent = posix.dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}

	async readFile(path: string): Promise<Buffer> {
		const content = this.files.get(path);
		if (!content) throw new Error(`ENOENT: ${path}`);
		return content;
	}

	async readText(path: string): Promise<string> {
		return (await this.readFile(path)).toString("utf8");
	}

	async writeFile(path: string, content: string | Buffer): Promise<void> {
		this.ensureDirectory(posix.dirname(path));
		this.files.set(path, Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, "utf8"));
	}

	async access(path: string, mode: "r" | "w" | "rw"): Promise<void> {
		if (!(await this.exists(path))) throw new Error(`ENOENT: ${path}`);
		if ((mode === "w" || mode === "rw") && this.info.remote) return;
	}

	async mkdir(path: string): Promise<void> {
		this.ensureDirectory(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.directories.has(path);
	}

	async stat(path: string): Promise<WorkspaceStat> {
		if (this.directories.has(path)) return { isDirectory: () => true, size: 0, mtimeMs: 1_700_000_000_000 };
		const file = this.files.get(path);
		if (!file) throw new Error(`ENOENT: ${path}`);
		return { isDirectory: () => false, size: file.length, mtimeMs: 1_700_000_000_000 };
	}

	async readdir(path: string): Promise<string[]> {
		if (!this.directories.has(path)) throw new Error(`ENOENT: ${path}`);
		const prefix = path === "/" ? "/" : `${path}/`;
		const names = new Set<string>();
		for (const file of this.files.keys()) {
			if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0]!);
		}
		for (const directory of this.directories) {
			if (directory !== path && directory.startsWith(prefix)) {
				names.add(directory.slice(prefix.length).split("/")[0]!);
			}
		}
		return [...names].sort();
	}

	async remove(path: string, options?: WorkspaceRemoveOptions): Promise<void> {
		const children = await this.readdir(path).catch(() => []);
		if (children.length > 0 && !options?.recursive) throw new Error(`Directory not empty: ${path}`);
		this.files.delete(path);
		this.directories.delete(path);
		const prefix = `${path}/`;
		for (const file of [...this.files.keys()]) if (file.startsWith(prefix)) this.files.delete(file);
		for (const directory of [...this.directories])
			if (directory.startsWith(prefix)) this.directories.delete(directory);
	}

	async move(from: string, to: string): Promise<void> {
		const file = this.files.get(from);
		if (file) {
			this.files.delete(from);
			await this.writeFile(to, file);
			return;
		}
		if (this.directories.has(from)) {
			this.ensureDirectory(to);
			for (const file of [...this.files.keys()]) {
				if (file.startsWith(`${from}/`)) {
					await this.writeFile(`${to}${file.slice(from.length)}`, this.files.get(file)!);
					this.files.delete(file);
				}
			}
			return;
		}
		throw new Error(`ENOENT: ${from}`);
	}

	async copy(from: string, to: string): Promise<void> {
		const file = this.files.get(from);
		if (file) {
			await this.writeFile(to, file);
			return;
		}
		if (this.directories.has(from)) {
			this.ensureDirectory(to);
			for (const candidate of [...this.files.keys()]) {
				if (candidate.startsWith(`${from}/`)) {
					await this.writeFile(`${to}${candidate.slice(from.length)}`, this.files.get(candidate)!);
				}
			}
			return;
		}
		throw new Error(`ENOENT: ${from}`);
	}

	async detectImageMimeType(path: string): Promise<string | null | undefined> {
		return path.endsWith(".png") ? "image/png" : null;
	}

	async glob(pattern: string, cwd: string, options: WorkspaceGlobOptions): Promise<string[]> {
		const results: string[] = [];
		const prefix = cwd === "/" ? "/" : `${cwd}/`;
		const matchBase = !pattern.includes("/");
		for (const file of this.files.keys()) {
			if (!file.startsWith(prefix)) continue;
			const relative = file.slice(prefix.length);
			if (options.ignore.some((ignore) => minimatch(relative, ignore, { dot: true }))) continue;
			if (minimatch(relative, pattern, { dot: true, matchBase })) results.push(relative);
			if (results.length >= options.limit) break;
		}
		return results;
	}

	async grep(options: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]> {
		const regex = new RegExp(
			options.literal ? escapeRegExp(options.pattern) : options.pattern,
			options.ignoreCase ? "i" : "",
		);
		const results: WorkspaceGrepMatch[] = [];
		const prefix = options.path === "/" ? "/" : `${options.path}/`;
		for (const [file, content] of this.files) {
			if (!file.startsWith(prefix)) continue;
			const lines = content.toString("utf8").split("\n");
			for (let index = 0; index < lines.length; index++) {
				if (regex.test(lines[index]!)) {
					results.push({ filePath: file, lineNumber: index + 1, lineText: lines[index] });
					if (results.length >= options.limit) return results;
				}
			}
		}
		return results;
	}

	async exec(command: string, args: string[], options: WorkspaceExecOptions = {}): Promise<WorkspaceExecResult> {
		if (!this.execHandler) throw new Error(`No fake exec handler for ${command}`);
		return this.execHandler(command, args, options);
	}

	async downloadToLocal(remotePath: string, localPath: string): Promise<void> {
		await mkdir(localDirname(localPath), { recursive: true });
		await writeFile(localPath, await this.readFile(remotePath));
	}

	async dispose(): Promise<void> {}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
