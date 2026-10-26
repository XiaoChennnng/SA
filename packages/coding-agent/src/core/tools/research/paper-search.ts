import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { searchPapers } from "../../../research/providers/index.ts";
import type { PaperSource } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import { formatPaper, type ResearchToolOptions, researchSettingsFor, researchStoreFor } from "./shared.ts";

const PAPER_SOURCE_SCHEMA = Type.Union([
	Type.Literal("arxiv"),
	Type.Literal("openalex"),
	Type.Literal("semanticscholar"),
	Type.Literal("crossref"),
	Type.Literal("pubmed"),
	Type.Literal("europepmc"),
	Type.Literal("openaire"),
	Type.Literal("doaj"),
	Type.Literal("core"),
	Type.Literal("hal"),
	Type.Literal("wanfang"),
	Type.Literal("cnki"),
	Type.Literal("nstl"),
]);

const paperSearchSchema = Type.Object({
	query: Type.String({ minLength: 1, description: "Keywords, title words, or an author/topic phrase." }),
	sources: Type.Optional(
		Type.Array(PAPER_SOURCE_SCHEMA, {
			description: "Sources to query. Default: all international sources plus any configured Chinese source.",
		}),
	),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum results (default: 10)." })),
	yearFrom: Type.Optional(Type.Integer({ minimum: 1800, description: "Earliest publication year." })),
	yearTo: Type.Optional(Type.Integer({ minimum: 1800, description: "Latest publication year." })),
	sort: Type.Optional(
		Type.Union([Type.Literal("relevance"), Type.Literal("citations"), Type.Literal("date")], {
			description: "Result ordering. Default: relevance.",
		}),
	),
	save: Type.Optional(
		Type.Boolean({
			description:
				"Save results to the local research knowledge base for later notes and citations (default: true).",
		}),
	),
});

export type PaperSearchToolInput = Static<typeof paperSearchSchema>;

export interface PaperSearchToolDetails {
	count: number;
	errors: Array<{ source: PaperSource; message: string }>;
	savedIds: string[];
}

export interface PaperSearchToolOptions extends Partial<ResearchToolOptions> {
	/** Inject a search implementation (tests, extensions, or a custom index). */
	search?: typeof searchPapers;
}

export const paperSearchToolSystemPromptContribution = {
	snippet:
		"Search scholarly literature (arXiv, OpenAlex, Semantic Scholar, Crossref, PubMed, Europe PMC, OpenAIRE, DOAJ, HAL) and configured sources (Wanfang, CNKI, NSTL, CORE)",
	guidelines: [
		"Use paper_search to find literature before making claims about prior work, and cite the returned DOI, arXiv ID, or paper ID",
		"Try several phrasings and synonyms before concluding that a topic has no relevant literature",
		"For Chinese-language literature, configure Wanfang APP_KEY, a CNKI command, or an institutional NSTL command with /research, then include the source",
	],
} as const;

export function createPaperSearchToolDefinition(
	_cwd: string,
	options?: PaperSearchToolOptions,
): ToolDefinition<typeof paperSearchSchema, PaperSearchToolDetails> {
	const search = options?.search ?? searchPapers;
	return {
		name: "paper_search",
		label: "paper_search",
		description:
			"Search scholarly literature across arXiv, OpenAlex, Semantic Scholar, Crossref, PubMed, Europe PMC, OpenAIRE, DOAJ, and HAL, plus configured sources (Wanfang via APP_KEY, CORE via API key, CNKI and NSTL via local commands). Returns deduplicated papers with DOI, arXiv ID, PMID, venue, citation count, abstract, and open-access PDF links. Results are saved to the local research knowledge base unless save is false.",
		promptSnippet: paperSearchToolSystemPromptContribution.snippet,
		promptGuidelines: [...paperSearchToolSystemPromptContribution.guidelines],
		parameters: paperSearchSchema,
		async execute(
			_toolCallId,
			params: PaperSearchToolInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			_ctx?: ExtensionContext,
		) {
			const settings = researchSettingsFor(options);
			const result = await search(
				{
					query: params.query,
					sources: params.sources as PaperSource[] | undefined,
					limit: params.limit,
					yearFrom: params.yearFrom,
					yearTo: params.yearTo,
					sort: params.sort,
				},
				{
					limit: params.limit ?? settings.maxResults,
					signal,
					timeoutMs: settings.requestTimeoutMs,
					mailto: settings.mailto,
					semanticScholarApiKey: settings.semanticScholarApiKey,
					ncbiApiKey: settings.ncbiApiKey,
					coreApiKey: settings.coreApiKey,
					wanfangAppKey: settings.wanfangAppKey,
					cnkiCommand: settings.cnkiCommand,
					nstlCommand: settings.nstlCommand,
				},
			);
			const savedIds: string[] = [];
			if (params.save !== false && result.papers.length > 0) {
				const store = researchStoreFor(options, settings);
				for (const paper of result.papers) {
					store.upsertPaper(paper);
					savedIds.push(paper.id);
				}
			}
			const lines: string[] = [
				`Found ${result.papers.length} paper${result.papers.length === 1 ? "" : "s"} for "${params.query}".`,
			];
			if (result.papers.length > 0) {
				lines.push("", ...result.papers.map((paper, index) => formatPaper(paper, index)));
			}
			if (result.errors.length > 0) {
				lines.push("", "Source errors:");
				for (const error of result.errors) lines.push(`- ${error.source}: ${error.message}`);
			}
			if (savedIds.length > 0) lines.push("", `Saved ${savedIds.length} papers to the research knowledge base.`);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: result.papers.length, errors: result.errors, savedIds },
			};
		},
	};
}

export function createPaperSearchTool(
	cwd: string,
	options?: PaperSearchToolOptions,
): AgentTool<typeof paperSearchSchema> {
	return wrapToolDefinition(createPaperSearchToolDefinition(cwd, options));
}
