import type { BashOperations } from "../../tools/bash.ts";
import type { EditOperations } from "../../tools/edit.ts";
import type { FindOperations } from "../../tools/find.ts";
import type { GrepOperations } from "../../tools/grep.ts";
import type { LsOperations } from "../../tools/ls.ts";
import type { ReadOperations } from "../../tools/read.ts";
import type { WriteOperations } from "../../tools/write.ts";
import type { ToolWorkspace } from "../types.ts";
import type { SshWorkspace } from "./workspace.ts";

export interface RemoteToolOperations {
	bash: BashOperations;
	read: ReadOperations;
	write: WriteOperations;
	edit: EditOperations;
	ls: LsOperations;
	find: FindOperations;
	grep: GrepOperations;
}

export function createRemoteToolOperations(workspace: ToolWorkspace): RemoteToolOperations | undefined {
	if (workspace.info.kind !== "ssh") return undefined;
	const remote = workspace as SshWorkspace;
	const bash: BashOperations = {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			const result = await remote.runBashScript(command, {
				cwd,
				timeoutMs: timeout === undefined ? undefined : timeout * 1000,
				signal,
				onData,
			});
			if (result.aborted) throw new Error("aborted");
			if (result.timedOut) throw new Error(`timeout:${timeout ?? 0}`);
			return { exitCode: result.code };
		},
	};
	const read: ReadOperations = {
		readFile: (path) => remote.readFile(path),
		access: (path) => remote.access(path, "r"),
		detectImageMimeType: (path) => remote.detectImageMimeType(path),
	};
	const write: WriteOperations = {
		writeFile: (path, content) => remote.writeFile(path, content),
		mkdir: (dir) => remote.mkdir(dir),
	};
	const edit: EditOperations = {
		readFile: (path) => remote.readFile(path),
		writeFile: (path, content) => remote.writeFile(path, content),
		access: (path) => remote.access(path, "rw"),
	};
	const ls: LsOperations = {
		exists: (path) => remote.exists(path),
		stat: (path) => remote.stat(path),
		readdir: (path) => remote.readdir(path),
	};
	const find: FindOperations = {
		exists: (path) => remote.exists(path),
		glob: (pattern, cwd, options) => remote.glob(pattern, cwd, options),
	};
	const grep: GrepOperations = {
		isDirectory: async (path) => (await remote.stat(path)).isDirectory(),
		readFile: (path) => remote.readText(path),
		search: (options) =>
			remote.grep({
				pattern: options.pattern,
				path: options.path,
				glob: options.glob,
				ignoreCase: options.ignoreCase,
				literal: options.literal,
				context: options.context,
				limit: options.limit,
				signal: options.signal,
			}),
	};
	return { bash, read, write, edit, ls, find, grep };
}
