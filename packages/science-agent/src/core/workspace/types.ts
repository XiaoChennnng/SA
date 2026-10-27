import type path from "node:path";

export type WorkspaceKind = "local" | "ssh";

export interface RemoteWorkspaceTarget {
	host: string;
	user?: string;
	port?: number;
	identityFile?: string;
	sshCommand?: string;
}

export interface RemoteWorkspaceInfo extends RemoteWorkspaceTarget {
	home: string;
	workspacePath: string;
	researchDir: string;
	platform: "linux" | "darwin";
	arch: string;
	loginShell: "bash" | "sh";
	/** Authentication used for this connection. Defaults to key/agent. */
	auth?: "key" | "password";
}

export interface WorkspaceInfo {
	kind: WorkspaceKind;
	cwd: string;
	display: string;
	remote?: RemoteWorkspaceInfo;
}

export interface WorkspaceStat {
	isDirectory(): boolean;
	size: number;
	mtimeMs: number;
}

export interface WorkspaceExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	stdin?: string | Buffer;
	timeoutMs?: number;
	signal?: AbortSignal;
	onData?: (data: Buffer) => void;
}

export interface WorkspaceExecResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	aborted: boolean;
}

export interface WorkspaceGrepOptions {
	pattern: string;
	path: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit: number;
	signal?: AbortSignal;
}

export interface WorkspaceGrepMatch {
	filePath: string;
	lineNumber: number;
	lineText?: string;
}

export interface WorkspaceGlobOptions {
	ignore: string[];
	limit: number;
}

export interface WorkspaceRemoveOptions {
	recursive?: boolean;
}

export interface ToolWorkspace {
	readonly info: WorkspaceInfo;
	readonly path: typeof path.posix;
	resolvePath(input: string): string;

	readFile(path: string): Promise<Buffer>;
	readText(path: string): Promise<string>;
	writeFile(path: string, content: string | Buffer): Promise<void>;
	access(path: string, mode: "r" | "w" | "rw"): Promise<void>;
	mkdir(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<WorkspaceStat>;
	readdir(path: string): Promise<string[]>;
	remove(path: string, options?: WorkspaceRemoveOptions): Promise<void>;
	move(from: string, to: string): Promise<void>;
	copy(from: string, to: string): Promise<void>;
	detectImageMimeType(path: string): Promise<string | null | undefined>;

	/** Returns paths relative to `cwd` with `/` separators. */
	glob(pattern: string, cwd: string, options: WorkspaceGlobOptions): Promise<string[]>;
	grep(options: WorkspaceGrepOptions): Promise<WorkspaceGrepMatch[]>;
	exec(command: string, args: string[], options?: WorkspaceExecOptions): Promise<WorkspaceExecResult>;
	downloadToLocal(remotePath: string, localPath: string, signal?: AbortSignal): Promise<void>;
	dispose?(): Promise<void>;
}
