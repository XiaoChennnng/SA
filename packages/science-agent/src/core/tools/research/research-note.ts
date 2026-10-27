import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { KnowledgeSection } from "../../../research/knowledge.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchKnowledgeFor } from "./shared.ts";

const researchNoteSchema = Type.Object({
	action: Type.Union([Type.Literal("save"), Type.Literal("search")]),
	content: Type.Optional(Type.String({ description: "Note body for action=save." })),
	title: Type.Optional(Type.String({ description: "Short title for action=save." })),
	kind: Type.Optional(
		Type.Union(
			[
				Type.Literal("note"),
				Type.Literal("summary"),
				Type.Literal("quote"),
				Type.Literal("idea"),
				Type.Literal("todo"),
			],
			{
				description: "Note kind (default: note).",
			},
		),
	),
	paperId: Type.Optional(Type.String({ description: "Link the note to a paper ID returned by paper_search." })),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Free-form tags." })),
	query: Type.Optional(Type.String({ description: "Case-insensitive text query for action=search." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 100, description: "Maximum sections to return (default: 10)." }),
	),
});

export type ResearchNoteToolInput = Static<typeof researchNoteSchema>;

export interface ResearchNoteToolDetails {
	action: ResearchNoteToolInput["action"];
	path: string;
	sections?: KnowledgeSection[];
}

export interface ResearchNoteToolOptions extends Partial<ResearchToolOptions> {}

export const researchNoteToolSystemPromptContribution = {
	snippet: "Append and search notes in the Markdown research knowledge base",
	guidelines: [
		"Use research_note to persist durable findings, decisions, and verbatim quotes instead of relying on conversation memory",
		"Notes are plain Markdown sections in research.md; link them to a paper or experiment and record uncertainty explicitly",
	],
} as const;

function firstLine(content: string): string {
	return content.trim().split("\n")[0]?.slice(0, 80).trim() ?? "";
}

function formatSection(section: KnowledgeSection): string {
	const body = section.body.length > 4000 ? `${section.body.slice(0, 4000).trimEnd()}…` : section.body;
	return `## ${section.heading}\n\n${body}`;
}

export function createResearchNoteToolDefinition(
	_cwd: string,
	options?: ResearchNoteToolOptions,
): ToolDefinition<typeof researchNoteSchema, ResearchNoteToolDetails> {
	return {
		name: "research_note",
		label: "research_note",
		description:
			"Append or search notes in the local Markdown research knowledge base (research.md). Notes become ordinary `##` sections, so they remain readable and editable with normal file tools.",
		promptSnippet: researchNoteToolSystemPromptContribution.snippet,
		promptGuidelines: [...researchNoteToolSystemPromptContribution.guidelines],
		parameters: researchNoteSchema,
		async execute(
			_toolCallId,
			params: ResearchNoteToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			const knowledge = researchKnowledgeFor(options);
			if (params.action === "save") {
				if (!params.content?.trim()) throw new Error("research_note save requires content");
				const kind = params.kind ?? "note";
				const title = params.title?.trim() || firstLine(params.content) || "Untitled note";
				const meta = [
					`- Date: ${new Date().toISOString()}`,
					params.paperId ? `- Paper: ${params.paperId}` : undefined,
					params.tags && params.tags.length > 0 ? `- Tags: ${params.tags.join(", ")}` : undefined,
				].filter((line): line is string => Boolean(line));
				knowledge.append(`Note [${kind}]: ${title}`, `${meta.join("\n")}\n\n${params.content.trim()}`);
				return {
					content: [{ type: "text", text: `Saved note "${title}" to ${knowledge.path}.` }],
					details: { action: "save", path: knowledge.path },
				};
			}
			if (!params.query?.trim()) throw new Error("research_note search requires query");
			let sections = knowledge.search(params.query, { prefix: "Note", limit: params.limit ?? 10 });
			if (params.paperId) sections = sections.filter((section) => section.body.includes(params.paperId!));
			const text =
				sections.length === 0
					? `No notes matched "${params.query}".`
					: `Found ${sections.length} note section(s) for "${params.query}":\n\n${sections.map(formatSection).join("\n\n")}`;
			return {
				content: [{ type: "text", text }],
				details: { action: "search", path: knowledge.path, sections },
			};
		},
	};
}

export function createResearchNoteTool(
	cwd: string,
	options?: ResearchNoteToolOptions,
): AgentTool<typeof researchNoteSchema> {
	return wrapToolDefinition(createResearchNoteToolDefinition(cwd, options));
}
