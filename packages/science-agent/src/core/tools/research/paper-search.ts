import type { AgentTool } from "@sa/agent-core";
import { type Static, Type } from "typebox";
import { searchPapers } from "../../../research/providers/index.ts";
import type { Paper, PaperSource } from "../../../research/types.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { wrapToolDefinition } from "../tool-definition-wrapper.ts";
import {
	formatAuthors,
	formatPaper,
	type ResearchToolOptions,
	researchKnowledgeFor,
	researchSettingsFor,
	truncateText,
} from "./shared.ts";

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
			description: "Append results to research.md (default: false).",
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
	snippet: "Search scholarly literature across international and configured Chinese sources",
	guidelines: [
		"Search before claiming prior work; cite the returned DOI, arXiv ID, or paper ID",
		"Try several phrasings before concluding a topic has no literature",
		"For Chinese sources, configure Wanfang, CNKI, or NSTL with /research",
	],
} as const;

function paperMarkdown(paper: Paper): string {
	const lines = [
		`- Authors: ${formatAuthors(paper.authors)}`,
		paper.year || paper.venue
			? `- Year: ${paper.year ?? "unknown"}${paper.venue ? ` · ${paper.venue}` : ""}`
			: undefined,
		paper.doi ? `- DOI: ${paper.doi}` : undefined,
		paper.arxivId ? `- arXiv: ${paper.arxivId}` : undefined,
		paper.pubmedId ? `- PMID: ${paper.pubmedId}` : undefined,
		paper.pdfUrl ? `- PDF: ${paper.pdfUrl}` : paper.url ? `- URL: ${paper.url}` : undefined,
		`- ID: ${paper.id}`,
	].filter((line): line is string => Boolean(line));
	const abstract = truncateText(paper.abstract, 1200);
	if (abstract) lines.push("", abstract);
	return lines.join("\n");
}

function alreadySaved(document: string, paper: Paper): boolean {
	if (document.includes(`## paper: ${paper.title}`.toLowerCase())) return true;
	const identifiers = [paper.id, paper.doi, paper.arxivId, paper.pubmedId].filter((value): value is string =>
		Boolean(value),
	);
	return identifiers.some((identifier) => document.includes(identifier.toLowerCase()));
}

export function createPaperSearchToolDefinition(
	_cwd: string,
	options?: PaperSearchToolOptions,
): ToolDefinition<typeof paperSearchSchema, PaperSearchToolDetails> {
	const search = options?.search ?? searchPapers;
	return {
		name: "paper_search",
		label: "paper_search",
		description:
			"Search scholarly literature across international and configured Chinese sources. Returns deduplicated papers with DOI, arXiv ID, PMID, venue, citations, abstract, and open-access PDF links. Set save=true to append results to research.md.",
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
			if (params.save === true && result.papers.length > 0) {
				const knowledge = researchKnowledgeFor(options, settings);
				let document = knowledge.read().toLowerCase();
				for (const paper of result.papers) {
					if (alreadySaved(document, paper)) continue;
					const body = paperMarkdown(paper);
					knowledge.append(`Paper: ${paper.title}`, body);
					document += `\n## Paper: ${paper.title}\n\n${body}`.toLowerCase();
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
			if (savedIds.length > 0) lines.push("", `Saved ${savedIds.length} papers to research.md.`);
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
