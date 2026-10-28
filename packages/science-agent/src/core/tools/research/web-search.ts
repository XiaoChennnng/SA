import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { type AnySearchSearchResponse, anySearchSearch } from "../../../research/anysearch.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { type ResearchToolOptions, researchSettingsFor, truncateText } from "./shared.ts";

const webSearchSchema = Type.Object({
	query: Type.String({ minLength: 1, description: "What to search for on the web." }),
	maxResults: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 10, description: "Number of results (default: 8, max: 10)." }),
	),
	zone: Type.Optional(
		Type.Union([Type.Literal("cn"), Type.Literal("intl")], {
			description: "Search zone: cn for Chinese web, intl for international web.",
		}),
	),
	language: Type.Optional(Type.String({ description: "Preferred result language, such as zh-CN or en." })),
	tag: Type.Optional(
		Type.String({ description: "AnySearch domain tag such as code.doc or finance.news; see web_search_domains." }),
	),
	format: Type.Optional(
		Type.Union([Type.Literal("json"), Type.Literal("markdown")], {
			description: "Content format in results (default: markdown).",
		}),
	),
});

export type WebSearchToolInput = Static<typeof webSearchSchema>;

export interface WebSearchToolDetails {
	query: string;
	count: number;
	results: AnySearchSearchResponse["results"];
	totalResults?: number;
	searchTimeMs?: number;
}

export interface WebSearchToolOptions extends Partial<ResearchToolOptions> {
	search?: typeof anySearchSearch;
}

export const webSearchToolSystemPromptContribution = {
	snippet: "Search the web with AnySearch",
	guidelines: ["Cite the result URL; use web_extract to read pages instead of trusting snippets"],
} as const;

export function createWebSearchToolDefinition(
	_cwd: string,
	options?: WebSearchToolOptions,
): ToolDefinition<typeof webSearchSchema, WebSearchToolDetails> {
	const search = options?.search ?? anySearchSearch;
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web with AnySearch and return titles, URLs, snippets, and content. Anonymous access is rate-limited.",
		promptSnippet: webSearchToolSystemPromptContribution.snippet,
		promptGuidelines: [...webSearchToolSystemPromptContribution.guidelines],
		parameters: webSearchSchema,
		async execute(
			_toolCallId,
			params: WebSearchToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			const settings = researchSettingsFor(options);
			const result = await search(
				{
					query: params.query,
					maxResults: params.maxResults,
					zone: params.zone,
					language: params.language,
					tag: params.tag,
					format: params.format ?? "markdown",
				},
				{ apiKey: settings.anySearchApiKey, signal, timeoutMs: settings.requestTimeoutMs },
			);
			const lines = [
				`Web search for "${params.query}": ${result.results.length} result${result.results.length === 1 ? "" : "s"}${
					result.searchTimeMs !== undefined ? ` in ${result.searchTimeMs}ms` : ""
				}.`,
			];
			for (const [index, item] of result.results.entries()) {
				lines.push("", `${index + 1}. ${item.title || "(untitled)"}`, `   URL: ${item.url}`);
				if (item.snippet) lines.push(`   ${item.snippet}`);
				const content = truncateText(item.content, 700);
				if (content) lines.push(`   ${content}`);
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					query: params.query,
					count: result.results.length,
					results: result.results,
					totalResults: result.totalResults,
					searchTimeMs: result.searchTimeMs,
				},
			};
		},
	};
}

export function createWebSearchTool(cwd: string, options?: WebSearchToolOptions): AgentTool<typeof webSearchSchema> {
	return wrapToolDefinition(createWebSearchToolDefinition(cwd, options));
}
