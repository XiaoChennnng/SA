import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.ts";
import { normalizeBuildSystemPromptOptions } from "../src/core/system-prompt.ts";
import { createLocalWorkspace } from "../src/core/workspace/local.ts";
import type { ToolWorkspace } from "../src/core/workspace/types.ts";
import { createMemoryExtension } from "../src/extensions/memory/index.ts";
import { FakeRemoteWorkspace } from "./helpers/fake-remote-workspace.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sa-memory-extension-"));
	tempDirs.push(dir);
	return dir;
}

type Handler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => void | Promise<void>;

function memoryHandler(options?: { maxMemoryChars?: number }): Handler {
	let handler: Handler | undefined;
	const sa = {
		on(event: string, callback: Handler) {
			if (event === "before_agent_start") handler = callback;
		},
	} as unknown as ExtensionAPI;
	createMemoryExtension(options)(sa);
	if (!handler) throw new Error("memory extension did not register a before_agent_start handler");
	return handler;
}

function buildEvent(
	cwd: string,
	contextFiles: Array<{ path: string; content: string }> = [],
	selectedTools?: string[],
) {
	const options = normalizeBuildSystemPromptOptions({
		cwd,
		contextFiles,
		...(selectedTools ? { selectedTools } : {}),
	});
	const event: BeforeAgentStartEvent = {
		type: "before_agent_start",
		messageType: "user",
		prompt: "",
		systemPrompt: "",
		systemPromptOptions: options,
	};
	return { event, options };
}

function localContext(cwd: string): ExtensionContext {
	return { cwd, workspace: createLocalWorkspace(cwd) } as ExtensionContext;
}

function remoteContext(cwd: string, workspace: ToolWorkspace): ExtensionContext {
	return { cwd, workspace } as ExtensionContext;
}

function displayPath(path: string): string {
	return path.replace(/\\/g, "/");
}

describe("memory extension", () => {
	it("injects workspace MEMORY.md into a workspace_memory section", async () => {
		const dir = tempDir();
		const memoryPath = join(dir, "MEMORY.md");
		writeFileSync(memoryPath, "# Memory\n\nPrefer tabs.\n");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir);

		await handler(event, localContext(dir));

		const section = options.sections.workspace_memory;
		expect(section).toContain(`File: ${displayPath(memoryPath)}`);
		expect(section).toContain("Prefer tabs.");
		expect(section).toContain("not user or project instructions");
		expect(options.promptGuidelines.some((rule) => rule.startsWith("Maintain AGENTS.md in the workspace root"))).toBe(
			true,
		);
	});

	it("falls back to MEMORY.MD", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "MEMORY.MD"), "Upper-case memory");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir);

		await handler(event, localContext(dir));

		expect(options.sections.workspace_memory).toContain("Upper-case memory");
	});

	it("removes stale memory sections when the file is absent, empty, or deleted", async () => {
		const dir = tempDir();
		const memoryPath = join(dir, "MEMORY.md");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir);

		await handler(event, localContext(dir));
		expect(options.sections.workspace_memory).toBeUndefined();

		writeFileSync(memoryPath, "remember this");
		await handler(event, localContext(dir));
		expect(options.sections.workspace_memory).toContain("remember this");

		writeFileSync(memoryPath, "   \n");
		await handler(event, localContext(dir));
		expect(options.sections.workspace_memory).toBeUndefined();

		writeFileSync(memoryPath, "again");
		await handler(event, localContext(dir));
		expect(options.sections.workspace_memory).toContain("again");

		rmSync(memoryPath);
		await handler(event, localContext(dir));
		expect(options.sections.workspace_memory).toBeUndefined();
	});

	it("truncates large memory files", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "MEMORY.md"), "x".repeat(500));
		const handler = memoryHandler({ maxMemoryChars: 200 });
		const { event, options } = buildEvent(dir);

		await handler(event, localContext(dir));

		const section = options.sections.workspace_memory ?? "";
		expect(section).toContain("[MEMORY.md truncated");
		expect(section).not.toContain("x".repeat(300));
	});

	it("refreshes workspace AGENTS.md without duplicating it", async () => {
		const dir = tempDir();
		const agentsPath = join(dir, "AGENTS.md");
		writeFileSync(agentsPath, "old rules");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir, [{ path: agentsPath, content: "stale rules" }]);

		await handler(event, localContext(dir));
		expect(options.contextFiles.filter((file) => file.path === agentsPath)).toHaveLength(1);
		expect(options.contextFiles.find((file) => file.path === agentsPath)?.content).toBe("old rules");

		writeFileSync(agentsPath, "new rules");
		await handler(event, localContext(dir));
		expect(options.contextFiles.find((file) => file.path === agentsPath)?.content).toBe("new rules");

		rmSync(agentsPath);
		await handler(event, localContext(dir));
		expect(options.contextFiles.some((file) => file.path === agentsPath)).toBe(false);

		writeFileSync(agentsPath, "created rules");
		await handler(event, localContext(dir));
		expect(options.contextFiles.find((file) => file.path === agentsPath)?.content).toBe("created rules");
	});

	it("loads remote MEMORY.md and AGENTS.md from an SSH workspace", async () => {
		const dir = tempDir();
		const remote = new FakeRemoteWorkspace();
		await remote.writeFile(remote.resolvePath("MEMORY.md"), "remote memory");
		await remote.writeFile(remote.resolvePath("AGENTS.md"), "remote rules");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir);

		await handler(event, remoteContext(dir, remote));

		expect(options.sections.workspace_memory).toContain("File: /work/MEMORY.md");
		expect(options.sections.workspace_memory).toContain("remote memory");
		expect(options.contextFiles.find((file) => file.path === "/work/AGENTS.md")?.content).toBe("remote rules");
	});

	it("prefers AGENTS.override.md and falls back to AGENTS.MD", async () => {
		const dir = tempDir();
		const remote = new FakeRemoteWorkspace();
		await remote.writeFile("/work/AGENTS.override.md", "override rules");
		await remote.writeFile("/work/AGENTS.md", "plain rules");
		const handler = memoryHandler();
		const first = buildEvent(dir);

		await handler(first.event, remoteContext(dir, remote));
		expect(first.options.contextFiles).toEqual([{ path: "/work/AGENTS.override.md", content: "override rules" }]);

		const fallback = new FakeRemoteWorkspace();
		await fallback.writeFile("/work/AGENTS.MD", "upper-case rules");
		const second = buildEvent(dir);
		await handler(second.event, remoteContext(dir, fallback));
		expect(second.options.contextFiles).toEqual([{ path: "/work/AGENTS.MD", content: "upper-case rules" }]);
	});

	it("does not duplicate a MEMORY.md already loaded as a context file", async () => {
		const dir = tempDir();
		const memoryPath = join(dir, "MEMORY.md");
		writeFileSync(memoryPath, "keep me");
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir, [{ path: memoryPath, content: "keep me" }]);

		await handler(event, localContext(dir));

		expect(options.sections.workspace_memory).toBeUndefined();
	});

	it("continues when workspace reads fail", async () => {
		const dir = tempDir();
		const workspace = {
			info: { kind: "local", cwd: dir, display: dir },
			path: { resolve },
			resolvePath: (input: string) => resolve(dir, input),
			readdir: async () => ["MEMORY.md", "AGENTS.md"],
			readText: async () => {
				throw new Error("permission denied");
			},
		} as unknown as ToolWorkspace;
		const handler = memoryHandler();
		const { event, options } = buildEvent(dir);

		await expect(handler(event, remoteContext(dir, workspace))).resolves.toBeUndefined();
		expect(options.sections.workspace_memory).toBeUndefined();
		expect(options.contextFiles).toEqual([]);
	});

	it("adds guidelines only when write or edit is active, without duplicates", async () => {
		const dir = tempDir();
		const handler = memoryHandler();

		const writable = buildEvent(dir, [], ["read", "write"]);
		await handler(writable.event, localContext(dir));
		await handler(writable.event, localContext(dir));
		expect(
			writable.options.promptGuidelines.filter((rule) =>
				rule.startsWith("Maintain AGENTS.md in the workspace root"),
			),
		).toHaveLength(1);
		expect(writable.options.promptGuidelines).toHaveLength(3);

		const readOnly = buildEvent(dir, [], ["read"]);
		await handler(readOnly.event, localContext(dir));
		expect(readOnly.options.promptGuidelines).toEqual([]);
	});
});
