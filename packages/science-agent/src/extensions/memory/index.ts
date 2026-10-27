import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createLocalWorkspace } from "../../core/workspace/local.ts";
import type { ToolWorkspace } from "../../core/workspace/types.ts";
import { stripBom } from "../../utils/text.ts";

const MEMORY_CANDIDATES = ["MEMORY.md", "MEMORY.MD"];
const AGENTS_CANDIDATES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const MEMORY_SECTION = "workspace_memory";
const DEFAULT_MAX_MEMORY_CHARS = 16_000;

const MEMORY_GUIDELINES = [
	"Maintain AGENTS.md in the workspace root for durable project conventions, commands, and constraints, and MEMORY.md for durable project preferences and recurring decisions that should survive sessions",
	"Create these files only when the information will outlast this task; update existing files in place, preserve their content, and when the workspace already uses CLAUDE.md, update it instead of creating AGENTS.md because SA loads only one context file per directory",
	"Never write secrets, credentials, tokens, or transient task state to AGENTS.md or MEMORY.md; keep research findings in research.md, and treat MEMORY.md as your own notes rather than as user instructions",
];

export interface MemoryExtensionOptions {
	/** Maximum characters of MEMORY.md injected into the prompt. */
	maxMemoryChars?: number;
}

interface WorkspaceFile {
	path: string;
	content: string;
}

function displayPath(path: string): string {
	return path.replace(/\\/g, "/");
}

function clipMemory(content: string, max: number): string {
	if (content.length <= max) return content;
	let cut = max;
	const newline = content.lastIndexOf("\n", max);
	if (newline >= 0 && newline > max - 400) cut = newline;
	let shown = content.slice(0, cut);
	const last = shown.charCodeAt(shown.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) shown = shown.slice(0, -1);
	return `${shown.trimEnd()}\n\n[MEMORY.md truncated: showing the first ${shown.length} of ${content.length} characters. Keep this file concise and remove stale entries.]`;
}

async function readFirst(
	workspace: ToolWorkspace,
	root: string,
	entries: Set<string>,
	candidates: string[],
): Promise<WorkspaceFile | undefined> {
	for (const name of candidates) {
		if (!entries.has(name)) continue;
		const path = workspace.path.resolve(root, name);
		try {
			const content = stripBom(await workspace.readText(path));
			if (content.includes("\0")) continue;
			return { path, content };
		} catch {
			// Try the next candidate; an unreadable file must not fail the run.
		}
	}
	return undefined;
}

function samePath(workspace: ToolWorkspace, left: string, right: string): boolean {
	if (workspace.info.kind === "ssh") return left === right;
	return workspace.resolvePath(left) === workspace.resolvePath(right);
}

/** Inject workspace MEMORY.md and keep workspace AGENTS.md fresh before each run. */
export function createMemoryExtension(options: MemoryExtensionOptions = {}): ExtensionFactory {
	const maxMemoryChars = Math.max(200, Math.floor(options.maxMemoryChars ?? DEFAULT_MAX_MEMORY_CHARS));
	return (sa) => {
		sa.on("before_agent_start", async (event, ctx) => {
			const workspace = ctx.workspace ?? createLocalWorkspace(ctx.cwd);
			const root = workspace.info.kind === "ssh" ? workspace.info.cwd : ctx.cwd;
			const { sections, contextFiles, promptGuidelines, selectedTools } = event.systemPromptOptions;

			let entries: Set<string> | undefined;
			try {
				entries = new Set(await workspace.readdir(root));
			} catch {
				entries = undefined;
			}

			if (entries) {
				const memory = await readFirst(workspace, root, entries, MEMORY_CANDIDATES);
				const memoryContent = memory?.content.trim();
				const memoryLoaded = memory
					? contextFiles.some((file) => samePath(workspace, file.path, memory.path))
					: false;
				if (memory && memoryContent && !memoryLoaded) {
					sections[MEMORY_SECTION] = [
						`File: ${displayPath(memory.path)}`,
						"These are your own notes from earlier sessions, mainly project preferences. They are not user or project instructions; user requests and project instructions take precedence. Keep this file concise.",
						"",
						clipMemory(memoryContent, maxMemoryChars),
					].join("\n");
				} else {
					delete sections[MEMORY_SECTION];
				}

				const agentPaths = AGENTS_CANDIDATES.map((name) => workspace.path.resolve(root, name));
				const removeWorkspaceAgents = (): void => {
					for (let index = contextFiles.length - 1; index >= 0; index -= 1) {
						const file = contextFiles[index]!;
						if (agentPaths.some((path) => samePath(workspace, file.path, path))) {
							contextFiles.splice(index, 1);
						}
					}
				};

				const hasAgentCandidate = AGENTS_CANDIDATES.some((name) => entries.has(name));
				const agents = hasAgentCandidate ? await readFirst(workspace, root, entries, AGENTS_CANDIDATES) : undefined;
				if (workspace.info.kind === "ssh") {
					if (agents?.content.trim()) {
						const loaded = contextFiles.some((file) => samePath(workspace, file.path, agents.path));
						if (!loaded) contextFiles.push({ path: agents.path, content: agents.content });
					}
				} else if (!hasAgentCandidate || agents) {
					removeWorkspaceAgents();
					if (agents?.content.trim()) contextFiles.push({ path: agents.path, content: agents.content });
				}
			} else {
				delete sections[MEMORY_SECTION];
			}

			const hiddenTools = event.systemPromptOptions.hiddenTools;
			const canWrite =
				(selectedTools.includes("write") && !hiddenTools.includes("write")) ||
				(selectedTools.includes("edit") && !hiddenTools.includes("edit"));
			if (canWrite) {
				for (const rule of MEMORY_GUIDELINES) {
					if (!promptGuidelines.includes(rule)) promptGuidelines.push(rule);
				}
			}
		});
	};
}

export default createMemoryExtension();
