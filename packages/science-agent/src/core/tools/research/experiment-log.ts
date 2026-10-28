import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import type { KnowledgeSection } from "../../../research/knowledge.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchKnowledgeFor } from "./shared.ts";

const AnyRecord = Type.Record(Type.String(), Type.Unknown());

const experimentLogSchema = Type.Object({
	action: Type.Union([Type.Literal("save"), Type.Literal("search")]),
	name: Type.Optional(Type.String({ description: "Experiment or run name for action=save." })),
	hypothesis: Type.Optional(Type.String({ description: "Hypothesis being tested." })),
	config: Type.Optional(AnyRecord),
	metrics: Type.Optional(AnyRecord),
	artifacts: Type.Optional(Type.Array(Type.String(), { description: "Paths or URLs of outputs, logs, or figures." })),
	status: Type.Optional(
		Type.Union([Type.Literal("planned"), Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed")]),
	),
	notes: Type.Optional(Type.String()),
	query: Type.Optional(Type.String({ description: "Case-insensitive text query for action=search." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 100, description: "Maximum sections to return (default: 10)." }),
	),
});

export type ExperimentLogToolInput = Static<typeof experimentLogSchema>;

export interface ExperimentLogToolDetails {
	action: ExperimentLogToolInput["action"];
	path: string;
	sections?: KnowledgeSection[];
}

export interface ExperimentLogToolOptions extends Partial<ResearchToolOptions> {}

export const experimentLogToolSystemPromptContribution = {
	snippet: "Append and search experiment runs in research.md",
	guidelines: [
		"Log every meaningful run with configuration and metrics, including failures; read logged runs before claiming an improvement",
	],
} as const;

function formatSection(section: KnowledgeSection): string {
	const body = section.body.length > 4000 ? `${section.body.slice(0, 4000).trimEnd()}…` : section.body;
	return `## ${section.heading}\n\n${body}`;
}

function jsonBlock(value: Record<string, unknown> | undefined): string {
	return `\`\`\`json\n${JSON.stringify(value ?? {}, null, 2)}\n\`\`\``;
}

export function createExperimentLogToolDefinition(
	_cwd: string,
	options?: ExperimentLogToolOptions,
): ToolDefinition<typeof experimentLogSchema, ExperimentLogToolDetails> {
	return {
		name: "experiment_log",
		label: "experiment_log",
		description: "Append or search experiment runs as Markdown sections in research.md.",
		promptSnippet: experimentLogToolSystemPromptContribution.snippet,
		promptGuidelines: [...experimentLogToolSystemPromptContribution.guidelines],
		parameters: experimentLogSchema,
		async execute(
			_toolCallId,
			params: ExperimentLogToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			const knowledge = researchKnowledgeFor(options);
			if (params.action === "save") {
				if (!params.name?.trim()) throw new Error("experiment_log save requires name");
				const status = params.status ?? "completed";
				const name = params.name.trim();
				const lines = [
					`- Date: ${new Date().toISOString()}`,
					params.hypothesis ? `- Hypothesis: ${params.hypothesis.trim()}` : undefined,
					params.artifacts && params.artifacts.length > 0
						? `- Artifacts: ${params.artifacts.join(", ")}`
						: undefined,
					"",
					"### Config",
					"",
					jsonBlock(params.config as Record<string, unknown> | undefined),
					"",
					"### Metrics",
					"",
					jsonBlock(params.metrics as Record<string, unknown> | undefined),
				].filter((line): line is string => line !== undefined);
				if (params.notes?.trim()) lines.push("", params.notes.trim());
				knowledge.append(`Experiment [${status}]: ${name}`, lines.join("\n"));
				return {
					content: [{ type: "text", text: `Saved experiment "${name}" to ${knowledge.path}.` }],
					details: { action: "save", path: knowledge.path },
				};
			}
			if (!params.query?.trim()) throw new Error("experiment_log search requires query");
			const sections = knowledge.search(params.query, { prefix: "Experiment", limit: params.limit ?? 10 });
			const text =
				sections.length === 0
					? `No experiments matched "${params.query}".`
					: sections.map(formatSection).join("\n\n");
			return {
				content: [{ type: "text", text }],
				details: { action: "search", path: knowledge.path, sections },
			};
		},
	};
}

export function createExperimentLogTool(
	cwd: string,
	options?: ExperimentLogToolOptions,
): AgentTool<typeof experimentLogSchema> {
	return wrapToolDefinition(createExperimentLogToolDefinition(cwd, options));
}
