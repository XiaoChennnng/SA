import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WorkspaceEntry {
	path: string;
	type: "file" | "directory";
	size: number;
	modifiedAt: string;
}

/** A research workspace confined to one root directory. */
export class ResearchWorkspace {
	readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
		mkdirSync(this.root, { recursive: true });
	}

	/** Resolve a workspace-relative path, rejecting absolute paths and `..` escapes. */
	resolvePath(input = "."): string {
		const candidate = resolve(this.root, input);
		const rel = relative(this.root, candidate);
		if (rel && (rel.startsWith("..") || isAbsolute(rel))) {
			throw new Error(`Path is outside the research workspace: ${input}`);
		}
		return candidate;
	}

	relativePath(path: string): string {
		const rel = relative(this.root, path);
		return rel ? rel.split(sep).join("/") : ".";
	}

	list(input = ".", options: { recursive?: boolean } = {}): WorkspaceEntry[] {
		const base = this.resolvePath(input);
		if (!existsSync(base)) throw new Error(`Path not found: ${input}`);
		const entries: WorkspaceEntry[] = [];
		const walk = (path: string) => {
			for (const name of readdirSync(path)) {
				const child = join(path, name);
				const stat = statSync(child);
				entries.push({
					path: this.relativePath(child),
					type: stat.isDirectory() ? "directory" : "file",
					size: stat.isDirectory() ? 0 : stat.size,
					modifiedAt: stat.mtime.toISOString(),
				});
				if (options.recursive && stat.isDirectory()) walk(child);
			}
		};
		walk(base);
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	mkdir(input: string): string {
		const path = this.resolvePath(input);
		mkdirSync(path, { recursive: true });
		return path;
	}

	write(input: string, content: string): string {
		const path = this.resolvePath(input);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
		return path;
	}

	read(input: string, maxChars = 200_000): { path: string; content: string; truncated: boolean } {
		const path = this.resolvePath(input);
		const stat = statSync(path);
		if (stat.isDirectory()) throw new Error(`Path is a directory: ${input}`);
		const content = readFileSync(path, "utf8");
		return {
			path,
			content: content.length > maxChars ? content.slice(0, maxChars) : content,
			truncated: content.length > maxChars,
		};
	}

	move(from: string, to: string): string {
		const source = this.resolvePath(from);
		const destination = this.resolvePath(to);
		mkdirSync(dirname(destination), { recursive: true });
		renameSync(source, destination);
		return destination;
	}

	copy(from: string, to: string): string {
		const source = this.resolvePath(from);
		const destination = this.resolvePath(to);
		mkdirSync(dirname(destination), { recursive: true });
		if (statSync(source).isDirectory()) cpSync(source, destination, { recursive: true });
		else copyFileSync(source, destination);
		return destination;
	}

	remove(input: string, recursive = false): string {
		const path = this.resolvePath(input);
		if (path === this.root) throw new Error("Refusing to remove the research workspace root");
		rmSync(path, { recursive, force: false });
		return path;
	}

	info(input = "."): WorkspaceEntry {
		const path = this.resolvePath(input);
		const stat = statSync(path);
		return {
			path: this.relativePath(path),
			type: stat.isDirectory() ? "directory" : "file",
			size: stat.isDirectory() ? 0 : stat.size,
			modifiedAt: stat.mtime.toISOString(),
		};
	}
}
