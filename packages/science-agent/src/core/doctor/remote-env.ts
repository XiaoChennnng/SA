import * as posix from "node:path/posix";
import { quotePosix } from "../workspace/ssh/args.ts";
import type { ToolWorkspace } from "../workspace/types.ts";
import type { DoctorEnvironment } from "./types.ts";

export function createRemoteDoctorEnvironment(workspace: ToolWorkspace): DoctorEnvironment {
	const remote = workspace.info.remote;
	if (!remote) throw new Error("Remote doctor needs an SSH workspace");
	return {
		kind: "ssh",
		label: workspace.info.display,
		platform: remote.platform,
		home: remote.home,
		remotePaths: {
			workspacePath: remote.workspacePath,
			researchDir: remote.researchDir,
		},
		async probe(command, args = ["--version"], options) {
			const result = await workspace.exec(command, args, { timeoutMs: 15_000 });
			const status = result.exitCode;
			const ok = status !== null && (options?.acceptStatus ? options.acceptStatus(status) : status === 0);
			return {
				ok,
				status,
				stdout: result.stdout,
				stderr: result.stderr,
				...(result.timedOut ? { error: "command timed out" } : {}),
			};
		},
		async which(command) {
			const result = await workspace.exec("sh", ["-c", `command -v ${quotePosix(command)}`], {
				timeoutMs: 15_000,
			});
			return result.exitCode === 0 ? result.stdout.trim().split(/\r?\n/)[0] : undefined;
		},
		async pathExists(path) {
			return workspace.exists(path);
		},
		async pathWritable(path) {
			let current = path;
			for (;;) {
				if (await workspace.exists(current)) {
					try {
						await workspace.access(current, "w");
						return true;
					} catch {
						return false;
					}
				}
				const parent = posix.dirname(current);
				if (parent === current) return false;
				current = parent;
			}
		},
		async readText(path) {
			try {
				return await workspace.readText(path);
			} catch {
				return undefined;
			}
		},
	};
}
