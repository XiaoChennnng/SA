import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { ResearchNote } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchStoreFor } from "./shared.ts";

const researchNoteSchema = Type.Object({
	action: Type.Union([
		Type.Literal("save"),
		Type.Literal("search"),
		Type.Literal("list"),
		Type.Literal("get"),
		Type.Literal("delete"),
	]),
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
	id: Type.Optional(Type.String({ description: "Note ID for get/delete/update." })),
	query: Type.Optional(Type.String({ description: "Full-text query for action=search." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 100, description: "Maximum notes to return (default: 10)." }),
	),
});

export type ResearchNoteToolInput = Static<typeof researchNoteSchema>;

export interface ResearchNoteToolDetails {
	action: ResearchNoteToolInput["action"];
	note?: ResearchNote;
	notes?: ResearchNote[];
	deleted?: boolean;
}

export interface ResearchNoteToolOptions extends Partial<ResearchToolOptions> {}

export const researchNoteToolSystemPromptContribution = {
	snippet: "Save and search research notes linked to papers, experiments, and tags",
	guidelines: [
		"Use research_note to persist durable findings, decisions, and verbatim quotes instead of relying on conversation memory",
		"Link notes to a paper ID or experiment when possible, and record uncertainty or contradictions explicitly",
	],
} as const;

function formatNote(note: ResearchNote, index?: number): string {
	const prefix = index === undefined ? "" : `${index + 1}. `;
	const lines = [`${prefix}[${note.kind}] ${note.title}`, `ID: ${note.id}`];
	if (note.paperId) lines.push(`Paper: ${note.paperId}`);
	if (note.tags.length > 0) lines.push(`Tags: ${note.tags.join(", ")}`);
	lines.push(`Updated: ${note.updatedAt}`, "", note.content);
	return lines.join("\n");
}

export function createResearchNoteToolDefinition(
	_cwd: string,
	options?: ResearchNoteToolOptions,
): ToolDefinition<typeof researchNoteSchema, ResearchNoteToolDetails> {
	const store = () => researchStoreFor(options);
	return {
		name: "research_note",
		label: "research_note",
		description:
			"Manage a local, full-text-searchable research notebook. Save notes, summaries, quotations, ideas, and todos; link them to papers or experiments; then search or list them later.",
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
			if (params.action === "save") {
				if (!params.content?.trim()) throw new Error("research_note save requires content");
				const note = store().saveNote({
					id: params.id,
					kind: params.kind,
					paperId: params.paperId,
					title: params.title,
					content: params.content,
					tags: params.tags,
				});
				return {
					content: [{ type: "text", text: `Saved research note.\n\n${formatNote(note)}` }],
					details: { action: "save", note },
				};
			}
			if (params.action === "search") {
				if (!params.query?.trim()) throw new Error("research_note search requires query");
				let notes = store().searchNotes(params.query, params.limit ?? 10);
				if (params.paperId) notes = notes.filter((note) => note.paperId === params.paperId);
				const text =
					notes.length === 0
						? `No notes matched "${params.query}".`
						: `Found ${notes.length} note(s) for "${params.query}":\n\n${notes.map((note, index) => formatNote(note, index)).join("\n\n")}`;
				return {
					content: [{ type: "text", text }],
					details: { action: "search", notes },
				};
			}
			if (params.action === "list") {
				let notes = store().listNotes(params.limit ?? 20);
				if (params.paperId) notes = notes.filter((note) => note.paperId === params.paperId);
				const text =
					notes.length === 0
						? "No research notes yet."
						: `${notes.length} note(s):\n\n${notes.map((note, index) => formatNote(note, index)).join("\n\n")}`;
				return {
					content: [{ type: "text", text }],
					details: { action: "list", notes },
				};
			}
			if (params.action === "get") {
				if (!params.id?.trim()) throw new Error("research_note get requires id");
				const note = store().getNote(params.id);
				if (!note) throw new Error(`No research note with id ${params.id}`);
				return {
					content: [{ type: "text", text: formatNote(note) }],
					details: { action: "get", note },
				};
			}
			if (!params.id?.trim()) throw new Error("research_note delete requires id");
			const deleted = store().deleteNote(params.id);
			return {
				content: [
					{
						type: "text",
						text: deleted ? `Deleted research note ${params.id}.` : `No research note with id ${params.id}.`,
					},
				],
				details: { action: "delete", deleted },
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
