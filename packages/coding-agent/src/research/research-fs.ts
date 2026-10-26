import * as posix from "node:path/posix";
import type { ToolWorkspace } from "../core/workspace/types.ts";
import type { ResearchWorkspace, WorkspaceEntry } from "./workspace.ts";

export interface ResearchReadResult {
	path: string;
	content: string;
	truncated: boolean;
}

export interface ResearchFs {
	readonly root: string;
	readonly displayRoot: string;
	resolvePath(input?: string): string;
	relativePath(path: string): string;
	ensureRoot(): Promise<void>;
	list(input?: string, options?: { recursive?: boolean }): Promise<WorkspaceEntry[]>;
	mkdir(input: string): Promise<string>;
	write(input: string, content: string): Promise<string>;
	read(input: string, maxChars?: number): Promise<ResearchReadResult>;
	move(from: string, to: string): Promise<string>;
	copy(from: string, to: string): Promise<string>;
	remove(input: string, recursive?: boolean): Promise<string>;
	info(input?: string): Promise<WorkspaceEntry>;
}

export class LocalResearchFs implements ResearchFs {
	readonly root: string;
	readonly displayRoot: string;
	private readonly workspace: ResearchWorkspace;

	constructor(workspace: ResearchWorkspace) {
		this.workspace = workspace;
		this.root = workspace.root;
		this.displayRoot = workspace.root;
	}

	resolvePath(input = "."): string {
		return this.workspace.resolvePath(input);
	}

	relativePath(path: string): string {
		return this.workspace.relativePath(path);
	}

	async ensureRoot(): Promise<void> {
		await this.workspace.mkdir(".");
	}

	async list(input = ".", options: { recursive?: boolean } = {}): Promise<WorkspaceEntry[]> {
		return this.workspace.list(input, options);
	}

	async mkdir(input: string): Promise<string> {
		return this.workspace.mkdir(input);
	}

	async write(input: string, content: string): Promise<string> {
		return this.workspace.write(input, content);
	}

	async read(input: string, maxChars = 200_000): Promise<ResearchReadResult> {
		return this.workspace.read(input, maxChars);
	}

	async move(from: string, to: string): Promise<string> {
		return this.workspace.move(from, to);
	}

	async copy(from: string, to: string): Promise<string> {
		return this.workspace.copy(from, to);
	}

	async remove(input: string, recursive = false): Promise<string> {
		return this.workspace.remove(input, recursive);
	}

	async info(input = "."): Promise<WorkspaceEntry> {
		return this.workspace.info(input);
	}
}

export class RemoteResearchFs implements ResearchFs {
	readonly root: string;
	readonly displayRoot: string;
	private readonly workspace: ToolWorkspace;
	private ready?: Promise<void>;

	constructor(workspace: ToolWorkspace) {
		const remote = workspace.info.remote;
		if (!remote) throw new Error("Remote research files need an SSH workspace");
		this.workspace = workspace;
		this.root = remote.researchDir;
		this.displayRoot = remote.researchDir;
	}

	resolvePath(input = "."): string {
		const candidate = posix.resolve(this.root, input);
		const relative = posix.relative(this.root, candidate);
		if (relative && (relative.startsWith("..") || posix.isAbsolute(relative))) {
			throw new Error(`Path is outside the research workspace: ${input}`);
		}
		if (posix.isAbsolute(input)) throw new Error(`Path is outside the research workspace: ${input}`);
		return candidate;
	}

	relativePath(path: string): string {
		const relative = posix.relative(this.root, path);
		return relative || ".";
	}

	async ensureRoot(): Promise<void> {
		this.ready ??= this.workspace.mkdir(this.root);
		await this.ready;
	}

	async list(input = ".", options: { recursive?: boolean } = {}): Promise<WorkspaceEntry[]> {
		await this.ensureRoot();
		const base = this.resolvePath(input);
		if (!(await this.workspace.exists(base))) throw new Error(`Path not found: ${input}`);
		const entries: WorkspaceEntry[] = [];
		const walk = async (path: string): Promise<void> => {
			for (const name of await this.workspace.readdir(path)) {
				const child = posix.join(path, name);
				const stat = await this.workspace.stat(child);
				entries.push({
					path: this.relativePath(child),
					type: stat.isDirectory() ? "directory" : "file",
					size: stat.isDirectory() ? 0 : stat.size,
					modifiedAt: new Date(stat.mtimeMs).toISOString(),
				});
				if (options.recursive && stat.isDirectory()) await walk(child);
			}
		};
		await walk(base);
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	async mkdir(input: string): Promise<string> {
		await this.ensureRoot();
		const path = this.resolvePath(input);
		await this.workspace.mkdir(path);
		return path;
	}

	async write(input: string, content: string): Promise<string> {
		await this.ensureRoot();
		const path = this.resolvePath(input);
		await this.workspace.mkdir(posix.dirname(path));
		await this.workspace.writeFile(path, content);
		return path;
	}

	async read(input: string, maxChars = 200_000): Promise<ResearchReadResult> {
		await this.ensureRoot();
		const path = this.resolvePath(input);
		const stat = await this.workspace.stat(path);
		if (stat.isDirectory()) throw new Error(`Path is a directory: ${input}`);
		const content = await this.workspace.readText(path);
		return {
			path,
			content: content.length > maxChars ? content.slice(0, maxChars) : content,
			truncated: content.length > maxChars,
		};
	}

	async move(from: string, to: string): Promise<string> {
		await this.ensureRoot();
		const source = this.resolvePath(from);
		const destination = this.resolvePath(to);
		await this.workspace.mkdir(posix.dirname(destination));
		await this.workspace.move(source, destination);
		return destination;
	}

	async copy(from: string, to: string): Promise<string> {
		await this.ensureRoot();
		const source = this.resolvePath(from);
		const destination = this.resolvePath(to);
		await this.workspace.mkdir(posix.dirname(destination));
		await this.workspace.copy(source, destination);
		return destination;
	}

	async remove(input: string, recursive = false): Promise<string> {
		await this.ensureRoot();
		const path = this.resolvePath(input);
		if (path === this.root) throw new Error("Refusing to remove the research workspace root");
		await this.workspace.remove(path, { recursive });
		return path;
	}

	async info(input = "."): Promise<WorkspaceEntry> {
		await this.ensureRoot();
		const path = this.resolvePath(input);
		const stat = await this.workspace.stat(path);
		return {
			path: this.relativePath(path),
			type: stat.isDirectory() ? "directory" : "file",
			size: stat.isDirectory() ? 0 : stat.size,
			modifiedAt: new Date(stat.mtimeMs).toISOString(),
		};
	}
}
