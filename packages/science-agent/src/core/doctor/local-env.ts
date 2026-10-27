import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { probeCommandSync } from "../../research/runtime.ts";
import { spawnProcessSync } from "../../utils/child-process.ts";
import { getToolPath } from "../../utils/tools-manager.ts";
import type { DoctorEnvironment } from "./types.ts";

function parentDirectory(path: string): string {
	const parent = dirname(path);
	return parent === path ? path : parent;
}

function findLocalExecutable(command: string): string | undefined {
	const locator = process.platform === "win32" ? "where" : "which";
	try {
		const result = spawnProcessSync(locator, [command], {
			encoding: "utf8",
			timeout: 5000,
			windowsHide: true,
		});
		if (result.status !== 0 || !result.stdout) return undefined;
		const first = result.stdout.trim().split(/\r?\n/)[0];
		return first && existsSync(first) ? first : undefined;
	} catch {
		return undefined;
	}
}

export function createLocalDoctorEnvironment(label: string): DoctorEnvironment {
	return {
		kind: "local",
		label,
		platform: process.platform,
		home: homedir(),
		nodeVersion: process.version,
		async probe(command, args = ["--version"], options) {
			return probeCommandSync(command, args, { acceptStatus: options?.acceptStatus });
		},
		async which(command) {
			if (command === "rg" || command === "fd") return getToolPath(command) ?? undefined;
			return findLocalExecutable(command);
		},
		async pathExists(path) {
			return existsSync(path);
		},
		async pathWritable(path) {
			let current = path;
			for (;;) {
				if (existsSync(current)) {
					try {
						accessSync(current, constants.W_OK);
						return true;
					} catch {
						return false;
					}
				}
				const parent = parentDirectory(current);
				if (parent === current) return false;
				current = parent;
			}
		},
		async readText(path) {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return undefined;
			}
		},
	};
}
