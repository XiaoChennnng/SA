/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   sa -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@sa/science-agent";
import { createBashTool } from "@sa/science-agent";

export default function (sa: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, SA_SPAWN_HOOK: "1" },
		}),
	});

	sa.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
