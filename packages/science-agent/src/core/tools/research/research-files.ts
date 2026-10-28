import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { WorkspaceEntry } from "../../../research/workspace.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchFsFor } from "./shared.ts";

const researchFilesSchema = Type.Object({
	action: Type.Union([
		Type.Literal("list"),
		Type.Literal("mkdir"),
		Type.Literal("write"),
		Type.Literal("read"),
		Type.Literal("move"),
		Type.Literal("copy"),
		Type.Literal("delete"),
		Type.Literal("info"),
	]),
	path: Type.Optional(Type.String({ description: "Workspace-relative file or directory path." })),
	from: Type.Optional(Type.String({ description: "Source path for move or copy." })),
	to: Type.Optional(Type.String({ description: "Destination path for move or copy." })),
	content: Type.Optional(Type.String({ description: "UTF-8 content for action=write." })),
	recursive: Type.Optional(
		Type.Boolean({ description: "List recursively, or delete a non-empty directory (default: false)." }),
	),
	maxChars: Type.Optional(
		Type.Integer({ minimum: 500, maximum: 500_000, description: "Read budget for action=read (default: 100000)." }),
	),
});

export type ResearchFilesToolInput = Static<typeof researchFilesSchema>;

export interface ResearchFilesToolDetails {
	action: ResearchFilesToolInput["action"];
	root: string;
	path?: string;
	entries?: WorkspaceEntry[];
	content?: string;
	truncated?: boolean;
}

export interface ResearchFilesToolOptions extends Partial<ResearchToolOptions> {}

export const researchFilesToolSystemPromptContribution = {
	snippet: "Manage files in the research workspace",
	guidelines: ["Organize artifacts under papers/, data/, figures/, and manuscripts/ instead of the project root"],
} as const;

function formatEntry(entry: WorkspaceEntry): string {
	const size = entry.type === "file" ? `${entry.size} B` : "dir";
	return `${entry.type === "directory" ? "d" : "f"} ${entry.path} (${size}, ${entry.modifiedAt})`;
}

export function createResearchFilesToolDefinition(
	_cwd: string,
	options?: ResearchFilesToolOptions,
): ToolDefinition<typeof researchFilesSchema, ResearchFilesToolDetails> {
	return {
		name: "research_files",
		label: "research_files",
		description: "Manage files inside the research workspace. Paths are confined to the workspace root.",
		promptSnippet: researchFilesToolSystemPromptContribution.snippet,
		promptGuidelines: [...researchFilesToolSystemPromptContribution.guidelines],
		parameters: researchFilesSchema,
		async execute(
			_toolCallId,
			params: ResearchFilesToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			ctx?: ExtensionContext,
		) {
			const workspace = researchFsFor(options, undefined, ctx);
			await workspace.ensureRoot();
			const root = workspace.displayRoot;
			if (params.action === "list") {
				const entries = await workspace.list(params.path ?? ".", { recursive: params.recursive });
				const text = entries.length > 0 ? entries.map(formatEntry).join("\n") : "(workspace is empty)";
				return {
					content: [{ type: "text", text: `Workspace: ${root}\n\n${text}` }],
					details: { action: "list", root, entries },
				};
			}
			if (params.action === "mkdir") {
				if (!params.path?.trim()) throw new Error("research_files mkdir requires path");
				const path = await workspace.mkdir(params.path);
				return {
					content: [{ type: "text", text: `Created directory: ${workspace.relativePath(path)}` }],
					details: { action: "mkdir", root, path },
				};
			}
			if (params.action === "write") {
				if (!params.path?.trim()) throw new Error("research_files write requires path");
				if (params.content === undefined) throw new Error("research_files write requires content");
				const path = await workspace.write(params.path, params.content);
				return {
					content: [
						{
							type: "text",
							text: `Wrote ${params.content.length} characters to ${workspace.relativePath(path)}`,
						},
					],
					details: { action: "write", root, path },
				};
			}
			if (params.action === "read") {
				if (!params.path?.trim()) throw new Error("research_files read requires path");
				const result = await workspace.read(params.path, params.maxChars ?? 100_000);
				return {
					content: [
						{
							type: "text",
							text: `${result.content}${result.truncated ? "\n\n[Truncated; use maxChars for more.]" : ""}`,
						},
					],
					details: {
						action: "read",
						root,
						path: result.path,
						content: result.content,
						truncated: result.truncated,
					},
				};
			}
			if (params.action === "move" || params.action === "copy") {
				if (!params.from?.trim() || !params.to?.trim()) {
					throw new Error(`research_files ${params.action} requires from and to`);
				}
				const path =
					params.action === "move"
						? await workspace.move(params.from, params.to)
						: await workspace.copy(params.from, params.to);
				const verb = params.action === "move" ? "Moved" : "Copied";
				return {
					content: [
						{
							type: "text",
							text: `${verb} ${workspace.relativePath(workspace.resolvePath(params.from))} to ${workspace.relativePath(path)}`,
						},
					],
					details: { action: params.action, root, path },
				};
			}
			if (params.action === "delete") {
				if (!params.path?.trim()) throw new Error("research_files delete requires path");
				const path = await workspace.remove(params.path, params.recursive);
				return {
					content: [{ type: "text", text: `Deleted ${workspace.relativePath(path)}` }],
					details: { action: "delete", root, path },
				};
			}
			const entry = await workspace.info(params.path ?? ".");
			return {
				content: [{ type: "text", text: `${formatEntry(entry)}\nWorkspace: ${root}` }],
				details: { action: "info", root, path: entry.path, entries: [entry] },
			};
		},
	};
}

export function createResearchFilesTool(
	cwd: string,
	options?: ResearchFilesToolOptions,
): AgentTool<typeof researchFilesSchema> {
	return wrapToolDefinition(createResearchFilesToolDefinition(cwd, options));
}
